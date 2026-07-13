mod utils;

use lending_contracts::programs::lending::LendingOffer;
use lending_contracts::programs::program::SimplexProgram;
use lending_session::{CreateOfferParams, IndexerClient, OfferParameters, Session, SessionError};
use serial_test::serial;
use simplex::provider::EsploraProvider;
use simplex::simplicityhl::elements::AssetId;
use smplx_regtest::{Regtest, RegtestConfig};

use utils::{
    FACTORY_ISSUING_UTXOS_COUNT, FACTORY_REISSUANCE_FLAGS, create_and_broadcast_factory,
    seed_active_factory, setup_test_pool, start_indexer_api,
};

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
    let signer_script = session.signer().get_address().script_pubkey().to_bytes();
    seed_active_factory(
        &pool,
        signer_script,
        factory_asset_id,
        program_script.clone(),
        FACTORY_ISSUING_UTXOS_COUNT as i16,
        FACTORY_REISSUANCE_FLAGS as i64,
        creation_txid,
        (creation_txid, auth_vout),
        (creation_txid, program_vout),
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
        (creation_txid, program_vout + 1_000),
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
