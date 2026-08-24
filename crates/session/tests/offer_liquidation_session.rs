mod utils;

use lending_indexer::models::OfferStatus;
use lending_session::SessionError;
use serial_test::serial;

use utils::{
    DEFAULT_LOAN_EXPIRATION_OFFSET, TEST_PRINCIPAL_AMOUNT, accept_pending_offer,
    assert_offer_status, build_session, build_session_with_signer, dummy_principal_asset_id,
    fund_asset_outputs, issue_asset, offer_params, setup_it_context_pool, setup_pending_offer,
    start_indexer_api,
};

const BORROWER_PRINCIPAL_ASSET_SUPPLY: u64 = 30_000;
const LIQUIDATION_LOAN_EXPIRATION_OFFSET: u32 = 20;

#[tokio::test]
#[serial]
async fn liquidate_offer_burns_lender_nft_and_returns_collateral_after_expiration()
-> anyhow::Result<()> {
    let (context, pool) = setup_it_context_pool().await?;
    let (indexer_url, server_handle) = start_indexer_api(pool.clone()).await?;
    let borrower = build_session(&context, &indexer_url);
    let lender = build_session_with_signer(&context, context.random_signer(), &indexer_url);

    let principal_asset_id = issue_asset(&borrower, 20_000)?;
    let (offer_id, offer) = setup_pending_offer(
        &borrower,
        &pool,
        offer_params(
            &borrower,
            principal_asset_id,
            LIQUIDATION_LOAN_EXPIRATION_OFFSET,
        )?,
    )
    .await?;

    fund_asset_outputs(
        &borrower,
        lender.signer(),
        principal_asset_id,
        &[TEST_PRINCIPAL_AMOUNT],
    )?;
    accept_pending_offer(&lender, &pool, offer_id, &offer).await?;

    fund_asset_outputs(&borrower, lender.signer(), principal_asset_id, &[1])?;

    context
        .get_network_utils()
        .mine_until_height((offer.parameters.offer_parameters.loan_expiration_time + 1) as u64)?;

    let liquidation_tx = lender.liquidate_offer(&offer_id.to_string()).await?;

    assert_eq!(liquidation_tx.n_inputs(), 2);
    assert_eq!(liquidation_tx.n_outputs(), 2);

    let outputs = liquidation_tx.outputs();
    assert_eq!(outputs[0].asset, offer.parameters.lender_nft_asset_id);
    assert_eq!(outputs[0].amount, 1);
    assert!(outputs[0].script_pubkey.is_op_return());
    assert_eq!(outputs[1].asset, offer.parameters.collateral_asset_id);
    assert_eq!(
        outputs[1].amount,
        offer.parameters.offer_parameters.collateral_amount
    );
    assert_eq!(
        outputs[1].script_pubkey,
        lender.signer().get_address().script_pubkey()
    );

    let receipt = lender.signer().broadcast(&liquidation_tx)?;
    let liquidation_txid = receipt.txid();
    receipt.wait()?;

    assert!(
        lender
            .signer()
            .get_utxos_asset(offer.parameters.lender_nft_asset_id)?
            .is_empty(),
        "lender NFT must be burned by the liquidation"
    );
    assert!(
        lender
            .signer()
            .get_utxos_asset(offer.parameters.collateral_asset_id)?
            .iter()
            .any(|utxo| {
                utxo.outpoint.txid == liquidation_txid
                    && utxo.outpoint.vout == 1
                    && utxo.amount() == offer.parameters.offer_parameters.collateral_amount
            }),
        "collateral must be returned to the lender's wallet"
    );

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn liquidate_offer_returns_loan_not_expired_before_expiration_height() -> anyhow::Result<()> {
    let (context, pool) = setup_it_context_pool().await?;
    let (indexer_url, server_handle) = start_indexer_api(pool.clone()).await?;
    let borrower = build_session(&context, &indexer_url);
    let lender = build_session_with_signer(&context, context.random_signer(), &indexer_url);

    let principal_asset_id = issue_asset(&borrower, 20_000)?;
    let (offer_id, offer) = setup_pending_offer(
        &borrower,
        &pool,
        offer_params(
            &borrower,
            principal_asset_id,
            LIQUIDATION_LOAN_EXPIRATION_OFFSET,
        )?,
    )
    .await?;

    fund_asset_outputs(
        &borrower,
        lender.signer(),
        principal_asset_id,
        &[TEST_PRINCIPAL_AMOUNT],
    )?;
    accept_pending_offer(&lender, &pool, offer_id, &offer).await?;

    let result = lender.liquidate_offer(&offer_id.to_string()).await;

    assert!(matches!(result, Err(SessionError::LoanNotExpired)));

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn liquidate_offer_returns_offer_not_active_for_pending_offer() -> anyhow::Result<()> {
    let (context, pool) = setup_it_context_pool().await?;
    let (indexer_url, server_handle) = start_indexer_api(pool.clone()).await?;
    let borrower = build_session(&context, &indexer_url);

    let (offer_id, _) = setup_pending_offer(
        &borrower,
        &pool,
        offer_params(
            &borrower,
            dummy_principal_asset_id(),
            LIQUIDATION_LOAN_EXPIRATION_OFFSET,
        )?,
    )
    .await?;

    let result = borrower.liquidate_offer(&offer_id.to_string()).await;

    assert!(matches!(result, Err(SessionError::OfferNotActive)));

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn liquidate_offer_fails_on_pending_offer() -> anyhow::Result<()> {
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

    let result = lender.liquidate_offer(&offer_id.to_string()).await;

    assert!(matches!(result, Err(SessionError::OfferNotActive)));
    assert_offer_status(&borrower, offer_id, OfferStatus::Pending).await?;

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn liquidate_offer_fails_before_expiration() -> anyhow::Result<()> {
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
            LIQUIDATION_LOAN_EXPIRATION_OFFSET,
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

    let result = lender.liquidate_offer(&offer_id.to_string()).await;

    assert!(matches!(result, Err(SessionError::LoanNotExpired)));
    assert_offer_status(&borrower, offer_id, OfferStatus::Active).await?;

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn borrower_cannot_liquidate_expired_offer() -> anyhow::Result<()> {
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
            LIQUIDATION_LOAN_EXPIRATION_OFFSET,
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

    fund_asset_outputs(&borrower, lender.signer(), principal_asset_id, &[1])?;
    context
        .get_network_utils()
        .mine_until_height((offer.parameters.offer_parameters.loan_expiration_time + 1) as u64)?;

    let result = borrower.liquidate_offer(&offer_id.to_string()).await;

    assert!(matches!(result, Err(SessionError::LenderNftUtxoNotFound)));
    assert_offer_status(&borrower, offer_id, OfferStatus::Active).await?;

    server_handle.abort();
    Ok(())
}
