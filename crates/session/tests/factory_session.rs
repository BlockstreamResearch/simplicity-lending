use std::env;
use std::path::PathBuf;

use anyhow::Context;
use lending_contracts::programs::issuance_factory::{IssuanceFactory, IssuanceFactoryParameters};
use lending_contracts::programs::program::SimplexProgram;
use lending_contracts::utils::get_random_seed;
use lending_indexer::api::server::run_server;
use lending_indexer::indexer::{insert_factory, insert_factory_auth_utxo, insert_factory_utxo};
use lending_indexer::models::{FactoryAuthModel, FactoryModel, FactoryStatus, FactoryUtxoModel};
use lending_session::{IndexerClient, Session, SessionError};
use serial_test::serial;
use simplex::provider::{EsploraProvider, SimplicityNetwork};
use simplex::signer::Signer;
use simplex::simplicityhl::elements::hashes::Hash;
use simplex::simplicityhl::elements::{AssetId, Txid};
use simplex::transaction::partial_input::IssuanceInput;
use simplex::transaction::{FinalTransaction, PartialInput, PartialOutput, RequiredSignature};
use sqlx::PgPool;
use tokio::net::TcpListener;
use uuid::Uuid;

const FACTORY_ISSUING_UTXOS_COUNT: u8 = 2;
const FACTORY_REISSUANCE_FLAGS: u64 = 0;
const RUN_IT_ENV: &str = "RUN_SESSION_INDEXER_IT";

fn context_config_path() -> PathBuf {
    env::temp_dir().join(format!("session-test-{}.toml", Uuid::new_v4()))
}

fn new_context() -> anyhow::Result<simplex::TestContext> {
    let config_path = context_config_path();
    simplex::TestConfig::default().to_file(&config_path)?;
    let context = simplex::TestContext::new(config_path.clone())
        .map_err(|e| anyhow::anyhow!("failed to initialize simplex test context: {e}"))?;
    let _ = std::fs::remove_file(config_path);
    Ok(context)
}

fn build_session(context: &simplex::TestContext, indexer_base_url: &str) -> Session {
    let signer = context.create_signer(&context.get_config().mnemonic);
    build_session_with_signer(context, signer, indexer_base_url)
}

fn build_session_with_signer(
    context: &simplex::TestContext,
    signer: Signer,
    indexer_base_url: &str,
) -> Session {
    // Session.provider is used as a network source here; UTXO and broadcast operations
    // in session methods are executed through signer/provider from the test context.
    let provider = EsploraProvider::new("http://127.0.0.1:1".to_owned(), *context.get_network());
    let indexer = IndexerClient::new(indexer_base_url).expect("build indexer client");
    Session::new(provider, signer, indexer)
}

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

fn integration_tests_enabled() -> bool {
    matches!(env::var(RUN_IT_ENV).as_deref(), Ok("1"))
}

async fn setup_it_context_pool() -> anyhow::Result<Option<(simplex::TestContext, PgPool)>> {
    if !integration_tests_enabled() {
        eprintln!("Skipping test: set RUN_SESSION_INDEXER_IT=1 to run DB-backed integration tests");
        return Ok(None);
    }

    let context = new_context()?;
    let Some(pool) = test_pool().await? else {
        eprintln!("Skipping test: DATABASE_URL is not set");
        return Ok(None);
    };

    Ok(Some((context, pool)))
}

async fn start_indexer_api(pool: PgPool) -> anyhow::Result<(String, tokio::task::JoinHandle<()>)> {
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let addr = listener.local_addr()?;
    let handle = tokio::spawn(async move {
        run_server(listener, pool).await;
    });
    Ok((format!("http://{addr}"), handle))
}

fn issuance_factory_for_network(network: SimplicityNetwork) -> IssuanceFactory {
    IssuanceFactory::new(IssuanceFactoryParameters {
        issuing_utxos_count: FACTORY_ISSUING_UTXOS_COUNT,
        reissuance_flags: FACTORY_REISSUANCE_FLAGS,
        network,
    })
}

#[allow(clippy::too_many_arguments)]
async fn seed_active_factory(
    pool: &PgPool,
    script_pubkey: Vec<u8>,
    factory_asset_id: AssetId,
    program_script_pubkey: Vec<u8>,
    issuing_utxos_count: i16,
    reissuance_flags: i64,
    created_at_txid: Txid,
    auth_outpoint: (Txid, i32),
    program_outpoint: (Txid, i32),
) -> anyhow::Result<()> {
    let factory_id = Uuid::new_v4();
    let created_at_height = 100_i64;

    let factory = FactoryModel {
        id: factory_id,
        factory_asset_id: factory_asset_id.into_inner().0.to_vec(),
        program_script_pubkey,
        issuing_utxos_count,
        reissuance_flags,
        current_status: FactoryStatus::Active,
        created_at_height,
        created_at_txid: created_at_txid.as_byte_array().to_vec(),
    };

    let auth_utxo = FactoryAuthModel {
        factory_id,
        script_pubkey,
        txid: auth_outpoint.0.as_byte_array().to_vec(),
        vout: auth_outpoint.1,
        created_at_height,
        spent_txid: None,
        spent_at_height: None,
    };

    let program_utxo = FactoryUtxoModel {
        factory_id,
        txid: program_outpoint.0.as_byte_array().to_vec(),
        vout: program_outpoint.1,
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

    let create_receipt = session.signer().broadcast(&create.transaction)?;
    let create_txid = create_receipt.txid();
    create_receipt.wait()?;

    let tx = session
        .signer()
        .get_provider()
        .fetch_transaction(&create_txid)?;
    let auth_vout = tx
        .output
        .iter()
        .position(|output| {
            output.asset.explicit() == Some(factory_asset_id)
                && output.script_pubkey == signer_script
        })
        .context("auth NFT output is missing in the creation tx")? as i32;
    let program_vout =
        tx.output
            .iter()
            .position(|output| {
                output.asset.explicit() == Some(factory_asset_id)
                    && output.script_pubkey == factory_program_script
            })
            .context("factory program output is missing in the creation tx")? as i32;

    Ok((
        factory_asset_id,
        create_txid,
        auth_vout,
        program_vout,
        factory_program_script.to_bytes(),
    ))
}

fn issue_only_program_factory_utxo(
    signer: &Signer,
    network: SimplicityNetwork,
) -> anyhow::Result<(AssetId, Txid, i32, Vec<u8>)> {
    let factory = issuance_factory_for_network(network);
    let factory_program_script = factory.get_script_pubkey();
    let policy_utxo = signer
        .get_utxos_asset(network.policy_asset())?
        .into_iter()
        .next()
        .context("expected at least one policy UTXO for issuance")?;

    let mut tx = FinalTransaction::new();
    let issuance = tx.add_issuance_input(
        PartialInput::new(policy_utxo),
        IssuanceInput::new_issuance(1, 0, get_random_seed()),
        RequiredSignature::NativeEcdsa,
    );
    tx.add_output(PartialOutput::new(
        factory_program_script.clone(),
        1,
        issuance.asset_id,
    ));

    let receipt = signer.broadcast(&tx)?;
    let txid = receipt.txid();
    receipt.wait()?;

    let chain_tx = signer.get_provider().fetch_transaction(&txid)?;
    let program_vout = chain_tx
        .output
        .iter()
        .position(|output| {
            output.asset.explicit() == Some(issuance.asset_id)
                && output.script_pubkey == factory_program_script
        })
        .context("expected program output in synthetic issuance tx")? as i32;

    Ok((
        issuance.asset_id,
        txid,
        program_vout,
        factory_program_script.to_bytes(),
    ))
}

#[tokio::test]
#[serial]
async fn create_factory_builds_and_broadcasts_transaction() -> anyhow::Result<()> {
    let Some((context, pool)) = setup_it_context_pool().await? else {
        return Ok(());
    };
    let (indexer_url, server_handle) = start_indexer_api(pool).await?;

    let session = build_session(&context, &indexer_url);
    let create = session.create_factory().await?;
    let factory_program_script =
        issuance_factory_for_network(session.network()).get_script_pubkey();

    assert_eq!(create.transaction.n_inputs(), 1);
    assert!(
        create
            .transaction
            .inputs()
            .iter()
            .any(|input| input.issuance_input.is_some()),
        "factory creation tx must include an issuance input"
    );
    assert!(
        create
            .transaction
            .outputs()
            .iter()
            .any(|output| output.asset == create.factory_asset_id && output.amount == 1),
        "factory creation tx must include auth NFT output"
    );
    assert!(
        create.transaction.outputs().iter().any(|output| {
            output.asset == create.factory_asset_id
                && output.script_pubkey == factory_program_script
        }),
        "factory creation tx must include factory program output"
    );

    let receipt = session.signer().broadcast(&create.transaction)?;
    receipt.wait()?;

    let auth_nft_utxos = session.signer().get_utxos_asset(create.factory_asset_id)?;
    assert!(
        !auth_nft_utxos.is_empty(),
        "wallet must own at least one auth NFT output after creation"
    );

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn create_factory_returns_no_policy_utxos_for_unfunded_signer() -> anyhow::Result<()> {
    let Some((context, pool)) = setup_it_context_pool().await? else {
        return Ok(());
    };
    let (indexer_url, server_handle) = start_indexer_api(pool).await?;

    let unfunded_signer = context.random_signer();
    let session = build_session_with_signer(&context, unfunded_signer, &indexer_url);
    let result = session.create_factory().await;

    assert!(matches!(result, Err(SessionError::NoPolicyUtxos)));

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn create_factory_rejects_when_indexer_reports_existing_factory() -> anyhow::Result<()> {
    let Some((context, pool)) = setup_it_context_pool().await? else {
        return Ok(());
    };

    let signer = context.create_signer(&context.get_config().mnemonic);
    let signer_script = signer.get_address().script_pubkey().to_bytes();
    let existing_factory_asset = AssetId::from_slice(&[7_u8; 32]).expect("valid asset id");
    let fake_txid = Txid::from_slice(&[0x11_u8; 32]).expect("valid txid");
    let program_script = issuance_factory_for_network(*context.get_network())
        .get_script_pubkey()
        .to_bytes();

    seed_active_factory(
        &pool,
        signer_script,
        existing_factory_asset,
        program_script,
        FACTORY_ISSUING_UTXOS_COUNT as i16,
        FACTORY_REISSUANCE_FLAGS as i64,
        fake_txid,
        (fake_txid, 0),
        (fake_txid, 1),
    )
    .await?;

    let (indexer_url, server_handle) = start_indexer_api(pool).await?;
    let session = build_session(&context, &indexer_url);
    let result = session.create_factory().await;

    assert!(matches!(
        result,
        Err(SessionError::BorrowerAccountAlreadyExists)
    ));

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn remove_factory_builds_and_broadcasts_transaction_when_factory_exists() -> anyhow::Result<()>
{
    let Some((context, pool)) = setup_it_context_pool().await? else {
        return Ok(());
    };
    let (indexer_url, server_handle) = start_indexer_api(pool.clone()).await?;
    let session = build_session(&context, &indexer_url);

    let (factory_asset_id, creation_txid, auth_vout, program_vout, program_script) =
        create_and_broadcast_factory(&session).await?;
    let signer_script = session.signer().get_address().script_pubkey().to_bytes();

    seed_active_factory(
        &pool,
        signer_script,
        factory_asset_id,
        program_script,
        FACTORY_ISSUING_UTXOS_COUNT as i16,
        FACTORY_REISSUANCE_FLAGS as i64,
        creation_txid,
        (creation_txid, auth_vout),
        (creation_txid, program_vout),
    )
    .await?;

    let remove_tx = session.remove_factory(factory_asset_id).await?;
    assert_eq!(remove_tx.n_inputs(), 2);

    let remove_receipt = session.signer().broadcast(&remove_tx)?;
    remove_receipt.wait()?;

    let auth_nft_utxos_after = session.signer().get_utxos_asset(factory_asset_id)?;
    assert!(
        auth_nft_utxos_after.is_empty(),
        "auth NFT should be consumed by remove transaction"
    );

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn remove_factory_returns_factory_program_utxo_not_found_when_outpoint_mismatches()
-> anyhow::Result<()> {
    let Some((context, pool)) = setup_it_context_pool().await? else {
        return Ok(());
    };
    let (indexer_url, server_handle) = start_indexer_api(pool.clone()).await?;
    let session = build_session(&context, &indexer_url);

    let (factory_asset_id, creation_txid, auth_vout, program_vout, program_script) =
        create_and_broadcast_factory(&session).await?;
    let signer_script = session.signer().get_address().script_pubkey().to_bytes();

    seed_active_factory(
        &pool,
        signer_script,
        factory_asset_id,
        program_script,
        FACTORY_ISSUING_UTXOS_COUNT as i16,
        FACTORY_REISSUANCE_FLAGS as i64,
        creation_txid,
        (creation_txid, auth_vout),
        (creation_txid, program_vout + 1000),
    )
    .await?;

    let result = session.remove_factory(factory_asset_id).await;
    assert!(matches!(
        result,
        Err(SessionError::FactoryProgramUtxoNotFound)
    ));

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn remove_factory_returns_auth_nft_utxo_not_found_when_wallet_missing_auth_token()
-> anyhow::Result<()> {
    let Some((context, pool)) = setup_it_context_pool().await? else {
        return Ok(());
    };
    let (indexer_url, server_handle) = start_indexer_api(pool.clone()).await?;
    let session = build_session(&context, &indexer_url);

    let (factory_asset_id, creation_txid, program_vout, program_script) =
        issue_only_program_factory_utxo(session.signer(), session.network())?;
    let signer_script = session.signer().get_address().script_pubkey().to_bytes();

    seed_active_factory(
        &pool,
        signer_script,
        factory_asset_id,
        program_script,
        FACTORY_ISSUING_UTXOS_COUNT as i16,
        FACTORY_REISSUANCE_FLAGS as i64,
        creation_txid,
        (creation_txid, 0),
        (creation_txid, program_vout),
    )
    .await?;

    let result = session.remove_factory(factory_asset_id).await;
    assert!(matches!(result, Err(SessionError::AuthNftUtxoNotFound)));

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn remove_factory_returns_invalid_state_for_oversized_issuing_utxos_count()
-> anyhow::Result<()> {
    let Some((context, pool)) = setup_it_context_pool().await? else {
        return Ok(());
    };

    let signer = context.create_signer(&context.get_config().mnemonic);
    let signer_script = signer.get_address().script_pubkey().to_bytes();
    let factory_asset_id = AssetId::from_slice(&[0x13_u8; 32]).expect("valid asset id");
    let fake_txid = Txid::from_slice(&[0x23_u8; 32]).expect("valid txid");
    let program_script = issuance_factory_for_network(*context.get_network())
        .get_script_pubkey()
        .to_bytes();

    seed_active_factory(
        &pool,
        signer_script,
        factory_asset_id,
        program_script,
        300,
        FACTORY_REISSUANCE_FLAGS as i64,
        fake_txid,
        (fake_txid, 0),
        (fake_txid, 1),
    )
    .await?;

    let (indexer_url, server_handle) = start_indexer_api(pool).await?;
    let session = build_session(&context, &indexer_url);
    let result = session.remove_factory(factory_asset_id).await;

    assert!(matches!(result, Err(SessionError::InvalidState)));

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn remove_factory_reports_not_found_for_missing_asset() -> anyhow::Result<()> {
    let Some((context, pool)) = setup_it_context_pool().await? else {
        return Ok(());
    };
    let (indexer_url, server_handle) = start_indexer_api(pool).await?;

    let session = build_session(&context, &indexer_url);
    let unknown_factory_asset = AssetId::from_slice(&[9_u8; 32]).expect("valid asset id");
    let result = session.remove_factory(unknown_factory_asset).await;

    assert!(matches!(result, Err(SessionError::FactoryNotFound)));

    server_handle.abort();
    Ok(())
}
