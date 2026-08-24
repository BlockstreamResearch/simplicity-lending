mod utils;

use lending_contracts::programs::lending::LendingOffer;
use lending_contracts::programs::program::SimplexProgram;
use lending_session::SessionError;
use serial_test::serial;

use utils::{
    DEFAULT_LOAN_EXPIRATION_OFFSET, FACTORY_ISSUING_UTXOS_COUNT, FACTORY_REISSUANCE_FLAGS,
    build_session, build_session_with_signer, create_active_factory, create_and_broadcast_factory,
    dummy_principal_asset_id, fund_policy_output, offer_params, remove_factory_and_index_it,
    seed_active_factory, setup_it_context_pool, start_indexer_api,
};

#[tokio::test]
#[serial]
async fn create_offer_builds_and_broadcasts_pending_offer() -> anyhow::Result<()> {
    let (context, pool) = setup_it_context_pool().await?;
    let (indexer_url, server_handle) = start_indexer_api(pool.clone()).await?;
    let session = build_session(&context, &indexer_url);

    let factory = create_active_factory(&session, &pool).await?;

    let params = offer_params(
        &session,
        dummy_principal_asset_id(),
        DEFAULT_LOAN_EXPIRATION_OFFSET,
    )?;
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
    assert_eq!(outputs[0].asset, factory.asset_id);
    assert_eq!(outputs[0].amount, 1);
    assert_eq!(outputs[1].asset, factory.asset_id);
    assert_eq!(
        outputs[1].script_pubkey.to_bytes(),
        factory.program_script_pubkey
    );
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
        .get_provider()?
        .fetch_transaction(&offer_creation_txid)?;
    let decoded =
        LendingOffer::try_from_tx(&chain_tx, expected_protocol_fee_asset, session.network())?;
    let decoded_parameters = decoded.offer.get_parameters();

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
            .get_provider()?
            .fetch_scripthash_utxos(&create.pending_offer.get_script_pubkey())?
            .is_empty()
    );

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn create_offer_fails_without_factory() -> anyhow::Result<()> {
    let (context, pool) = setup_it_context_pool().await?;
    let (indexer_url, server_handle) = start_indexer_api(pool).await?;
    let session = build_session(&context, &indexer_url);

    let result = session
        .create_offer(offer_params(
            &session,
            dummy_principal_asset_id(),
            DEFAULT_LOAN_EXPIRATION_OFFSET,
        )?)
        .await;

    assert!(matches!(result, Err(SessionError::FactoryNotFound)));

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn create_offer_fails_after_factory_removed() -> anyhow::Result<()> {
    let (context, pool) = setup_it_context_pool().await?;
    let (indexer_url, server_handle) = start_indexer_api(pool.clone()).await?;
    let session = build_session(&context, &indexer_url);

    let factory = create_active_factory(&session, &pool).await?;
    remove_factory_and_index_it(&session, &pool, &factory).await?;

    let result = session
        .create_offer(offer_params(
            &session,
            dummy_principal_asset_id(),
            DEFAULT_LOAN_EXPIRATION_OFFSET,
        )?)
        .await;
    assert!(matches!(result, Err(SessionError::FactoryNotFound)));

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn create_offer_fails_with_insufficient_collateral() -> anyhow::Result<()> {
    let (context, pool) = setup_it_context_pool().await?;
    let (indexer_url, server_handle) = start_indexer_api(pool.clone()).await?;
    let donor = build_session(&context, &indexer_url);
    let borrower = build_session_with_signer(&context, context.random_signer(), &indexer_url);

    fund_policy_output(&donor, borrower.signer(), 1_000_000)?;
    let _factory = create_active_factory(&borrower, &pool).await?;

    let policy_asset = borrower.network().policy_asset();
    let collateral_amount = offer_params(
        &borrower,
        dummy_principal_asset_id(),
        DEFAULT_LOAN_EXPIRATION_OFFSET,
    )?
    .offer_parameters
    .collateral_amount;

    let mut drain_attempts = 0_u8;
    loop {
        let policy_utxos = borrower.signer().get_utxos_asset(policy_asset)?;
        let total_policy_amount = policy_utxos.iter().map(|utxo| utxo.amount()).sum::<u64>();
        if total_policy_amount < collateral_amount {
            break;
        }

        let largest_utxo_amount = policy_utxos
            .iter()
            .map(|utxo| utxo.amount())
            .max()
            .expect("at least one policy UTXO must exist while draining");
        let drain_amount = largest_utxo_amount.saturating_sub(500);
        assert!(
            drain_amount > 0,
            "policy UTXO too small to drain collateral balance"
        );
        fund_policy_output(&borrower, donor.signer(), drain_amount)?;

        drain_attempts += 1;
        assert!(
            drain_attempts <= 16,
            "failed to drain borrower policy balance below collateral threshold"
        );
    }

    let result = borrower
        .create_offer(offer_params(
            &borrower,
            dummy_principal_asset_id(),
            DEFAULT_LOAN_EXPIRATION_OFFSET,
        )?)
        .await;

    match result {
        Err(SessionError::CollateralUtxoNotFound) => {}
        Err(other) => panic!("unexpected create_offer error: {other:?}"),
        Ok(_) => panic!("create_offer unexpectedly succeeded without collateral"),
    }

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn create_offer_rejects_mismatched_indexed_program_outpoint() -> anyhow::Result<()> {
    let (context, pool) = setup_it_context_pool().await?;
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
        (creation_txid, program_vout + 1_000),
    )
    .await?;

    let result = session
        .create_offer(offer_params(
            &session,
            dummy_principal_asset_id(),
            DEFAULT_LOAN_EXPIRATION_OFFSET,
        )?)
        .await;

    assert!(matches!(
        result,
        Err(SessionError::FactoryProgramUtxoNotFound)
    ));

    server_handle.abort();
    Ok(())
}
