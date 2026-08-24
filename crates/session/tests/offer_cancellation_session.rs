mod utils;

use lending_indexer::indexer::update_offer_status;
use lending_indexer::models::OfferStatus;
use lending_session::SessionError;
use serial_test::serial;

use utils::{
    DEFAULT_LOAN_EXPIRATION_OFFSET, TEST_PRINCIPAL_AMOUNT, accept_pending_offer,
    assert_offer_status, build_session, build_session_with_signer, cancel_pending_offer,
    create_active_factory, create_and_broadcast_offer, dummy_principal_asset_id,
    fund_asset_outputs, issue_asset, offer_params, seed_pending_offer, setup_it_context_pool,
    setup_pending_offer, start_indexer_api,
};

const BORROWER_PRINCIPAL_ASSET_SUPPLY: u64 = 30_000;

#[tokio::test]
#[serial]
async fn cancel_offer_burns_nfts_and_returns_collateral_to_borrower() -> anyhow::Result<()> {
    let (context, pool) = setup_it_context_pool().await?;
    let (indexer_url, server_handle) = start_indexer_api(pool.clone()).await?;
    let session = build_session(&context, &indexer_url);

    let (offer_id, offer) = setup_pending_offer(
        &session,
        &pool,
        offer_params(
            &session,
            dummy_principal_asset_id(),
            DEFAULT_LOAN_EXPIRATION_OFFSET,
        )?,
    )
    .await?;

    let cancel_tx = session.cancel_offer(&offer_id.to_string()).await?;

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

    let (offer_id, _) = setup_pending_offer(
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
    update_offer_status(&mut sql_tx, offer_id, OfferStatus::Active, 100).await?;
    sql_tx.commit().await?;

    let result = session.cancel_offer(&offer_id.to_string()).await;

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

    let factory = create_active_factory(&session, &pool).await?;

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
    let offer_id = seed_pending_offer(&pool, factory.id, &offer_creation).await?;

    let result = session.cancel_offer(&offer_id.to_string()).await;

    assert!(matches!(
        result,
        Err(SessionError::PendingOfferUtxoNotFound)
    ));

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn borrower_cannot_cancel_another_borrowers_offer() -> anyhow::Result<()> {
    let (context, pool) = setup_it_context_pool().await?;
    let (indexer_url, server_handle) = start_indexer_api(pool.clone()).await?;
    let borrower_a = build_session(&context, &indexer_url);
    let borrower_b = build_session_with_signer(&context, context.random_signer(), &indexer_url);

    let (offer_id, _) = setup_pending_offer(
        &borrower_a,
        &pool,
        offer_params(
            &borrower_a,
            dummy_principal_asset_id(),
            DEFAULT_LOAN_EXPIRATION_OFFSET,
        )?,
    )
    .await?;

    let result = borrower_b.cancel_offer(&offer_id.to_string()).await;

    assert!(matches!(result, Err(SessionError::BorrowerNftUtxoNotFound)));

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn cancel_offer_fails_on_active_offer() -> anyhow::Result<()> {
    let (context, pool) = setup_it_context_pool().await?;
    let (indexer_url, server_handle) = start_indexer_api(pool.clone()).await?;
    let borrower = build_session(&context, &indexer_url);
    let lender = build_session_with_signer(&context, context.random_signer(), &indexer_url);

    let principal_asset_id = issue_asset(&borrower, BORROWER_PRINCIPAL_ASSET_SUPPLY)?;
    let (offer_id, offer) = setup_pending_offer(
        &borrower,
        &pool,
        offer_params(
            &borrower,
            principal_asset_id,
            DEFAULT_LOAN_EXPIRATION_OFFSET,
        )?,
    )
    .await?;
    assert_offer_status(&borrower, offer_id, OfferStatus::Pending).await?;

    fund_asset_outputs(
        &borrower,
        lender.signer(),
        principal_asset_id,
        &[TEST_PRINCIPAL_AMOUNT],
    )?;
    accept_pending_offer(&lender, &pool, offer_id, &offer).await?;
    assert_offer_status(&borrower, offer_id, OfferStatus::Active).await?;

    let result = borrower.cancel_offer(&offer_id.to_string()).await;

    assert!(matches!(result, Err(SessionError::OfferNotPending)));
    assert_offer_status(&borrower, offer_id, OfferStatus::Active).await?;

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn cancel_offer_fails_when_already_cancelled() -> anyhow::Result<()> {
    let (context, pool) = setup_it_context_pool().await?;
    let (indexer_url, server_handle) = start_indexer_api(pool.clone()).await?;
    let borrower = build_session(&context, &indexer_url);

    let (offer_id, offer) = setup_pending_offer(
        &borrower,
        &pool,
        offer_params(
            &borrower,
            dummy_principal_asset_id(),
            DEFAULT_LOAN_EXPIRATION_OFFSET,
        )?,
    )
    .await?;
    assert_offer_status(&borrower, offer_id, OfferStatus::Pending).await?;

    cancel_pending_offer(&borrower, &pool, offer_id, &offer).await?;
    assert_offer_status(&borrower, offer_id, OfferStatus::Cancelled).await?;

    let result = borrower.cancel_offer(&offer_id.to_string()).await;

    assert!(matches!(result, Err(SessionError::OfferNotPending)));
    assert_offer_status(&borrower, offer_id, OfferStatus::Cancelled).await?;

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn lender_cannot_cancel_pending_offer() -> anyhow::Result<()> {
    let (context, pool) = setup_it_context_pool().await?;
    let (indexer_url, server_handle) = start_indexer_api(pool.clone()).await?;
    let borrower = build_session(&context, &indexer_url);
    let lender = build_session_with_signer(&context, context.random_signer(), &indexer_url);

    let (offer_id, _) = setup_pending_offer(
        &borrower,
        &pool,
        offer_params(
            &borrower,
            dummy_principal_asset_id(),
            DEFAULT_LOAN_EXPIRATION_OFFSET,
        )?,
    )
    .await?;
    assert_offer_status(&borrower, offer_id, OfferStatus::Pending).await?;

    let result = lender.cancel_offer(&offer_id.to_string()).await;

    assert!(matches!(result, Err(SessionError::BorrowerNftUtxoNotFound)));
    assert_offer_status(&borrower, offer_id, OfferStatus::Pending).await?;

    server_handle.abort();
    Ok(())
}
