use std::env;

use anyhow::Context;
use lending_contracts::programs::issuance_factory::{IssuanceFactory, IssuanceFactoryParameters};
use lending_contracts::programs::lending::LendingOffer;
use lending_contracts::programs::program::SimplexProgram;
use lending_indexer::api::server::run_server;
use lending_indexer::indexer::{insert_factory, insert_factory_auth_utxo, insert_factory_utxo};
use lending_indexer::models::{FactoryAuthModel, FactoryModel, FactoryStatus, FactoryUtxoModel};
use lending_session::{CreateOfferParams, IndexerClient, OfferParameters, Session, SessionError};
use serial_test::serial;
use simplex::provider::{EsploraProvider, SimplicityNetwork};
use simplex::simplicityhl::elements::hashes::Hash;
use simplex::simplicityhl::elements::{AssetId, Txid};
use smplx_regtest::{Regtest, RegtestConfig};
use sqlx::PgPool;
use tokio::net::TcpListener;
use uuid::Uuid;

const FACTORY_ISSUING_UTXOS_COUNT: u8 = 2;
const FACTORY_REISSUANCE_FLAGS: u64 = 0;
const RUN_IT_ENV: &str = "RUN_SESSION_INDEXER_IT";

async fn test_pool() -> anyhow::Result<Option<PgPool>> {
    let Ok(database_url) = env::var("DATABASE_URL") else {
        return Ok(None);
    };

    let pool = PgPool::connect(&database_url).await?;
    sqlx::migrate!("../indexer/migrations").run(&pool).await?;
    sqlx::query(
        r#"
        TRUNCATE TABLE
            offer_participants,
            offer_utxos,
            offers,
            factory_auths,
            factory_utxos,
            factories,
            sync_state
        RESTART IDENTITY CASCADE
        "#,
    )
    .execute(&pool)
    .await?;

    Ok(Some(pool))
}

async fn setup_test_pool() -> anyhow::Result<Option<PgPool>> {
    if !matches!(env::var(RUN_IT_ENV).as_deref(), Ok("1")) {
        eprintln!("Skipping test: set RUN_SESSION_INDEXER_IT=1 to run DB-backed integration tests");
        return Ok(None);
    }

    let Some(pool) = test_pool().await? else {
        eprintln!("Skipping test: DATABASE_URL is not set");
        return Ok(None);
    };

    Ok(Some(pool))
}

async fn start_indexer_api(pool: PgPool) -> anyhow::Result<(String, tokio::task::JoinHandle<()>)> {
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let addr = listener.local_addr()?;
    let handle = tokio::spawn(async move {
        run_server(listener, pool).await;
    });

    Ok((format!("http://{addr}"), handle))
}

fn build_session(
    indexer_base_url: &str,
) -> anyhow::Result<(smplx_regtest::client::RegtestClient, Session)> {
    let config = RegtestConfig::default();
    let (client, signer) = Regtest::from_config(&config)?;
    let network = *signer.get_provider().get_network();
    let provider = EsploraProvider::new(client.esplora_url(), network);
    let indexer = IndexerClient::new(indexer_base_url)?;

    Ok((client, Session::new(provider, signer, indexer)))
}

fn issuance_factory_for_network(network: SimplicityNetwork) -> IssuanceFactory {
    IssuanceFactory::new(IssuanceFactoryParameters {
        issuing_utxos_count: FACTORY_ISSUING_UTXOS_COUNT,
        reissuance_flags: FACTORY_REISSUANCE_FLAGS,
        network,
    })
}

async fn seed_active_factory(
    pool: &PgPool,
    session: &Session,
    factory_asset_id: AssetId,
    creation_txid: Txid,
    auth_vout: i32,
    program_vout: i32,
    program_script_pubkey: Vec<u8>,
) -> anyhow::Result<()> {
    let factory_id = Uuid::new_v4();
    let created_at_height = i64::from(session.signer().get_provider().fetch_tip_height()?);

    let factory = FactoryModel {
        id: factory_id,
        factory_asset_id: factory_asset_id.into_inner().0.to_vec(),
        program_script_pubkey,
        issuing_utxos_count: i16::from(FACTORY_ISSUING_UTXOS_COUNT),
        reissuance_flags: FACTORY_REISSUANCE_FLAGS as i64,
        current_status: FactoryStatus::Active,
        created_at_height,
        created_at_txid: creation_txid.as_byte_array().to_vec(),
    };
    let auth_utxo = FactoryAuthModel {
        factory_id,
        script_pubkey: session.signer().get_address().script_pubkey().to_bytes(),
        txid: creation_txid.as_byte_array().to_vec(),
        vout: auth_vout,
        created_at_height,
        spent_txid: None,
        spent_at_height: None,
    };
    let program_utxo = FactoryUtxoModel {
        factory_id,
        txid: creation_txid.as_byte_array().to_vec(),
        vout: program_vout,
        created_at_height,
        spent_txid: None,
        spent_at_height: None,
    };

    let mut sql_tx = pool.begin().await?;
    insert_factory(&mut sql_tx, &factory).await?;
    insert_factory_auth_utxo(&mut sql_tx, &auth_utxo).await?;
    insert_factory_utxo(&mut sql_tx, &program_utxo).await?;
    sql_tx.commit().await?;

    Ok(())
}

async fn create_and_broadcast_factory(
    session: &Session,
) -> anyhow::Result<(AssetId, Txid, i32, i32, Vec<u8>)> {
    let create = session.create_factory().await?;
    let factory_asset_id = create.factory_asset_id;
    let signer_script = session.signer().get_address().script_pubkey();
    let factory_program_script =
        issuance_factory_for_network(session.network()).get_script_pubkey();

    let receipt = session.signer().broadcast(&create.transaction)?;
    let creation_txid = receipt.txid();
    receipt.wait()?;

    let tx = session
        .signer()
        .get_provider()
        .fetch_transaction(&creation_txid)?;
    let auth_vout = tx
        .output
        .iter()
        .position(|output| {
            output.asset.explicit() == Some(factory_asset_id)
                && output.script_pubkey == signer_script
        })
        .context("factory auth output is missing")? as i32;
    let program_vout = tx
        .output
        .iter()
        .position(|output| {
            output.asset.explicit() == Some(factory_asset_id)
                && output.script_pubkey == factory_program_script
        })
        .context("factory program output is missing")? as i32;

    Ok((
        factory_asset_id,
        creation_txid,
        auth_vout,
        program_vout,
        factory_program_script.to_bytes(),
    ))
}

fn offer_params(session: &Session) -> anyhow::Result<CreateOfferParams> {
    let current_height = session.signer().get_provider().fetch_tip_height()?;

    Ok(CreateOfferParams {
        principal_asset_id: AssetId::from_slice(&[0x31; 32])?,
        protocol_fee_keeper_asset_id: AssetId::from_slice(&[0x41; 32])?,
        offer_parameters: OfferParameters {
            collateral_amount: 3_000,
            principal_amount: 10_000,
            loan_expiration_time: current_height + 60,
            principal_interest_rate: 1_000,
        },
    })
}

#[tokio::test]
#[serial]
async fn create_offer_builds_and_broadcasts_pending_offer() -> anyhow::Result<()> {
    let Some(pool) = setup_test_pool().await? else {
        return Ok(());
    };
    let (indexer_url, server_handle) = start_indexer_api(pool.clone()).await?;
    let (_regtest, session) = build_session(&indexer_url)?;

    let (factory_asset_id, creation_txid, auth_vout, program_vout, program_script) =
        create_and_broadcast_factory(&session).await?;
    seed_active_factory(
        &pool,
        &session,
        factory_asset_id,
        creation_txid,
        auth_vout,
        program_vout,
        program_script.clone(),
    )
    .await?;

    let params = offer_params(&session)?;
    let expected_principal_asset = params.principal_asset_id;
    let expected_protocol_fee_asset = params.protocol_fee_keeper_asset_id;
    let expected_offer_parameters = params.offer_parameters;
    let create = session.create_offer(params).await?;
    let pending_parameters = *create.pending_offer.get_parameters();

    assert_eq!(create.transaction.n_inputs(), 3);
    assert_eq!(create.transaction.n_outputs(), 6);
    assert_eq!(
        create
            .transaction
            .inputs()
            .iter()
            .filter(|input| input.issuance_input.is_some())
            .count(),
        2
    );
    assert!(create.pending_offer.is_pending_offer());
    assert_eq!(
        pending_parameters.principal_asset_id,
        expected_principal_asset
    );
    assert_eq!(
        pending_parameters.protocol_fee_keeper_asset_id,
        expected_protocol_fee_asset
    );
    assert_eq!(
        pending_parameters.offer_parameters,
        expected_offer_parameters
    );
    assert_ne!(
        pending_parameters.borrower_nft_asset_id,
        pending_parameters.lender_nft_asset_id
    );

    let outputs = create.transaction.outputs();
    assert_eq!(outputs[0].asset, factory_asset_id);
    assert_eq!(outputs[0].amount, 1);
    assert_eq!(outputs[1].asset, factory_asset_id);
    assert_eq!(outputs[1].script_pubkey.to_bytes(), program_script);
    assert_eq!(outputs[2].asset, pending_parameters.borrower_nft_asset_id);
    assert_eq!(outputs[2].amount, 1);
    assert_eq!(outputs[3].asset, pending_parameters.lender_nft_asset_id);
    assert_eq!(outputs[3].amount, 1);
    assert_eq!(outputs[4].amount, 0);
    assert_eq!(outputs[5].asset, session.network().policy_asset());
    assert_eq!(
        outputs[5].amount,
        expected_offer_parameters.collateral_amount
    );

    let receipt = session.signer().broadcast(&create.transaction)?;
    let offer_creation_txid = receipt.txid();
    receipt.wait()?;

    let chain_tx = session
        .signer()
        .get_provider()
        .fetch_transaction(&offer_creation_txid)?;
    let decoded_offer =
        LendingOffer::try_from_tx(&chain_tx, expected_protocol_fee_asset, session.network())?;
    let decoded_parameters = decoded_offer.get_parameters();

    assert_eq!(
        decoded_parameters.principal_asset_id,
        pending_parameters.principal_asset_id
    );
    assert_eq!(
        decoded_parameters.borrower_nft_asset_id,
        pending_parameters.borrower_nft_asset_id
    );
    assert_eq!(
        decoded_parameters.lender_nft_asset_id,
        pending_parameters.lender_nft_asset_id
    );
    assert_eq!(
        decoded_parameters.offer_parameters,
        pending_parameters.offer_parameters
    );
    assert!(
        !session
            .signer()
            .get_utxos_asset(pending_parameters.borrower_nft_asset_id)?
            .is_empty()
    );
    assert!(
        !session
            .signer()
            .get_provider()
            .fetch_scripthash_utxos(&create.pending_offer.get_script_pubkey())?
            .is_empty()
    );

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn create_offer_returns_factory_not_found_when_indexer_is_empty() -> anyhow::Result<()> {
    let Some(pool) = setup_test_pool().await? else {
        return Ok(());
    };
    let (indexer_url, server_handle) = start_indexer_api(pool).await?;
    let (_regtest, session) = build_session(&indexer_url)?;

    let result = session.create_offer(offer_params(&session)?).await;

    assert!(matches!(result, Err(SessionError::FactoryNotFound)));

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn create_offer_rejects_mismatched_indexed_program_outpoint() -> anyhow::Result<()> {
    let Some(pool) = setup_test_pool().await? else {
        return Ok(());
    };
    let (indexer_url, server_handle) = start_indexer_api(pool.clone()).await?;
    let (_regtest, session) = build_session(&indexer_url)?;

    let (factory_asset_id, creation_txid, auth_vout, program_vout, program_script) =
        create_and_broadcast_factory(&session).await?;
    seed_active_factory(
        &pool,
        &session,
        factory_asset_id,
        creation_txid,
        auth_vout,
        program_vout + 1_000,
        program_script,
    )
    .await?;

    let result = session.create_offer(offer_params(&session)?).await;

    assert!(matches!(
        result,
        Err(SessionError::FactoryProgramUtxoNotFound)
    ));

    server_handle.abort();
    Ok(())
}
