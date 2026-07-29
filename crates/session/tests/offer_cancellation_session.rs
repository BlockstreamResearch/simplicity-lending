mod utils;

use lending_indexer::indexer::update_offer_status;
use lending_indexer::models::OfferStatus;
use lending_session::SessionError;
use serial_test::serial;

use utils::{
    DEFAULT_LOAN_EXPIRATION_OFFSET, FACTORY_ISSUING_UTXOS_COUNT, FACTORY_REISSUANCE_FLAGS,
    build_session, create_and_broadcast_factory, create_and_broadcast_offer,
    dummy_principal_asset_id, offer_params, seed_active_factory, seed_pending_offer,
    setup_it_context_pool, setup_pending_offer, start_indexer_api,
};

#[tokio::test]
#[serial]
async fn cancel_offer_burns_nfts_and_returns_collateral_to_borrower() -> anyhow::Result<()> {
    let (context, pool) = setup_it_context_pool().await?;
    let (indexer_url, server_handle) = start_indexer_api(pool.clone()).await?;
    let session = build_session(&context, &indexer_url);

    let offer = setup_pending_offer(
        &session,
        &pool,
        offer_params(
            &session,
            dummy_principal_asset_id(),
            DEFAULT_LOAN_EXPIRATION_OFFSET,
        )?,
    )
    .await?;

    let cancel_tx = session.cancel_offer("1").await?;

    assert_eq!(cancel_tx.n_inputs(), 3);
    assert_eq!(cancel_tx.n_outputs(), 3);

    let outputs = cancel_tx.outputs();
    assert_eq!(outputs[0].asset, offer.parameters.lender_nft_asset_id);
    assert_eq!(outputs[0].amount, 1);
    assert!(outputs[0].script_pubkey.is_op_return());
    assert_eq!(outputs[1].asset, offer.parameters.borrower_nft_asset_id);
    assert_eq!(outputs[1].amount, 1);
    assert!(outputs[1].script_pubkey.is_op_return());
    assert_eq!(outputs[2].asset, offer.parameters.collateral_asset_id);
    assert_eq!(
        outputs[2].amount,
        offer.parameters.offer_parameters.collateral_amount
    );
    assert_eq!(
        outputs[2].script_pubkey,
        session.signer().get_confidential_address().script_pubkey()
    );
    assert_eq!(
        outputs[2].blinding_key,
        Some(session.signer().get_blinding_public_key())
    );

    let receipt = session.signer().broadcast(&cancel_tx)?;
    let cancel_txid = receipt.txid();
    receipt.wait()?;

    assert!(
        session
            .signer()
            .get_utxos_asset(offer.parameters.borrower_nft_asset_id)?
            .is_empty(),
        "borrower NFT must be burned by the cancellation"
    );
    assert!(
        session
            .signer()
            .get_utxos_asset(offer.parameters.collateral_asset_id)?
            .iter()
            .any(|utxo| {
                utxo.outpoint.txid == cancel_txid
                    && utxo.outpoint.vout == 2
                    && utxo.amount() == offer.parameters.offer_parameters.collateral_amount
            }),
        "collateral must be returned to the borrower's wallet"
    );

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn cancel_offer_returns_offer_not_pending_for_active_offer() -> anyhow::Result<()> {
    let (context, pool) = setup_it_context_pool().await?;
    let (indexer_url, server_handle) = start_indexer_api(pool.clone()).await?;
    let session = build_session(&context, &indexer_url);

    setup_pending_offer(
        &session,
        &pool,
        offer_params(
            &session,
            dummy_principal_asset_id(),
            DEFAULT_LOAN_EXPIRATION_OFFSET,
        )?,
    )
    .await?;

    let mut sql_tx = pool.begin().await?;
    update_offer_status(&mut sql_tx, 1, OfferStatus::Active, 100).await?;
    sql_tx.commit().await?;

    let result = session.cancel_offer("1").await;

    assert!(matches!(result, Err(SessionError::OfferNotPending)));

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn cancel_offer_returns_pending_offer_utxo_not_found_for_mismatched_outpoint()
-> anyhow::Result<()> {
    let (context, pool) = setup_it_context_pool().await?;
    let (indexer_url, server_handle) = start_indexer_api(pool.clone()).await?;
    let session = build_session(&context, &indexer_url);

    let (factory_asset_id, factory_creation_txid, auth_vout, program_vout, program_script) =
        create_and_broadcast_factory(&session).await?;
    let signer_script = session.signer().get_address().script_pubkey().to_bytes();
    let factory_id = seed_active_factory(
        &pool,
        signer_script,
        factory_asset_id,
        program_script,
        FACTORY_ISSUING_UTXOS_COUNT as i16,
        FACTORY_REISSUANCE_FLAGS as i64,
        factory_creation_txid,
        (factory_creation_txid, auth_vout),
        (factory_creation_txid, program_vout),
    )
    .await?;

    let mut offer_creation = create_and_broadcast_offer(
        &session,
        offer_params(
            &session,
            dummy_principal_asset_id(),
            DEFAULT_LOAN_EXPIRATION_OFFSET,
        )?,
    )
    .await?;
    offer_creation.pending_offer_vout += 1_000;
    seed_pending_offer(&pool, factory_id, &offer_creation).await?;

    let result = session.cancel_offer("1").await;

    assert!(matches!(
        result,
        Err(SessionError::PendingOfferUtxoNotFound)
    ));

    server_handle.abort();
    Ok(())
}
