#[path = "../utils/mod.rs"]
mod utils;

use lending_indexer::models::OfferStatus;
use serial_test::serial;

use utils::{
    DEFAULT_LOAN_EXPIRATION_OFFSET, TEST_PRINCIPAL_AMOUNT, accept_pending_offer,
    assert_offer_status, build_session, build_session_with_signer, cancel_pending_offer,
    claim_borrower_principal, claim_lender_vault, fund_asset_outputs, issue_asset,
    liquidate_active_offer, offer_params, repay_active_offer, setup_it_context_pool,
    setup_pending_offer, start_indexer_api,
};

const BORROWER_PRINCIPAL_ASSET_SUPPLY: u64 = 30_000;
const LIQUIDATION_LOAN_EXPIRATION_OFFSET: u32 = 20;

#[tokio::test]
#[serial]
async fn full_loan_cycle_with_claim_principal_completes_to_claimed() -> anyhow::Result<()> {
    let (context, pool) = setup_it_context_pool().await?;
    let (indexer_url, server_handle) = start_indexer_api(pool.clone()).await?;
    let borrower = build_session(&context, &indexer_url);
    let lender = build_session_with_signer(&context, context.random_signer(), &indexer_url);

    let principal_asset_id = issue_asset(&borrower, BORROWER_PRINCIPAL_ASSET_SUPPLY)?;
    let offer = setup_pending_offer(
        &borrower,
        &pool,
        offer_params(
            &borrower,
            principal_asset_id,
            DEFAULT_LOAN_EXPIRATION_OFFSET,
        )?,
    )
    .await?;
    let offer_id = 1;
    assert_offer_status(&borrower, offer_id, OfferStatus::Pending).await?;

    fund_asset_outputs(
        &borrower,
        lender.signer(),
        principal_asset_id,
        &[TEST_PRINCIPAL_AMOUNT],
    )?;
    let (_, accept_txid) = accept_pending_offer(&lender, &pool, offer_id, &offer).await?;
    assert_offer_status(&borrower, offer_id, OfferStatus::Active).await?;

    claim_borrower_principal(&borrower, &pool, offer_id, &offer, accept_txid).await?;
    assert_offer_status(&borrower, offer_id, OfferStatus::Active).await?;

    let repay_txid = repay_active_offer(&borrower, &pool, offer_id, accept_txid).await?;
    assert_offer_status(&borrower, offer_id, OfferStatus::Repaid).await?;

    claim_lender_vault(&lender, &pool, offer_id, accept_txid, repay_txid).await?;
    assert_offer_status(&borrower, offer_id, OfferStatus::Claimed).await?;

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn full_loan_cycle_without_claim_principal_completes_to_claimed() -> anyhow::Result<()> {
    let (context, pool) = setup_it_context_pool().await?;
    let (indexer_url, server_handle) = start_indexer_api(pool.clone()).await?;
    let borrower = build_session(&context, &indexer_url);
    let lender = build_session_with_signer(&context, context.random_signer(), &indexer_url);

    let principal_asset_id = issue_asset(&borrower, BORROWER_PRINCIPAL_ASSET_SUPPLY)?;
    let offer = setup_pending_offer(
        &borrower,
        &pool,
        offer_params(
            &borrower,
            principal_asset_id,
            DEFAULT_LOAN_EXPIRATION_OFFSET,
        )?,
    )
    .await?;
    let offer_id = 1;
    assert_offer_status(&borrower, offer_id, OfferStatus::Pending).await?;

    fund_asset_outputs(
        &borrower,
        lender.signer(),
        principal_asset_id,
        &[TEST_PRINCIPAL_AMOUNT],
    )?;
    let (_, accept_txid) = accept_pending_offer(&lender, &pool, offer_id, &offer).await?;
    assert_offer_status(&borrower, offer_id, OfferStatus::Active).await?;

    let repay_txid = repay_active_offer(&borrower, &pool, offer_id, accept_txid).await?;
    assert_offer_status(&borrower, offer_id, OfferStatus::Repaid).await?;

    claim_lender_vault(&lender, &pool, offer_id, accept_txid, repay_txid).await?;
    assert_offer_status(&borrower, offer_id, OfferStatus::Claimed).await?;

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn pending_offer_can_be_cancelled_by_borrower() -> anyhow::Result<()> {
    let (context, pool) = setup_it_context_pool().await?;
    let (indexer_url, server_handle) = start_indexer_api(pool.clone()).await?;
    let borrower = build_session(&context, &indexer_url);

    let principal_asset_id = issue_asset(&borrower, BORROWER_PRINCIPAL_ASSET_SUPPLY)?;
    let offer = setup_pending_offer(
        &borrower,
        &pool,
        offer_params(
            &borrower,
            principal_asset_id,
            DEFAULT_LOAN_EXPIRATION_OFFSET,
        )?,
    )
    .await?;
    let offer_id = 1;
    assert_offer_status(&borrower, offer_id, OfferStatus::Pending).await?;

    cancel_pending_offer(&borrower, &pool, offer_id, &offer).await?;
    assert_offer_status(&borrower, offer_id, OfferStatus::Cancelled).await?;

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn expired_active_offer_can_be_liquidated_by_lender() -> anyhow::Result<()> {
    let (context, pool) = setup_it_context_pool().await?;
    let (indexer_url, server_handle) = start_indexer_api(pool.clone()).await?;
    let borrower = build_session(&context, &indexer_url);
    let lender = build_session_with_signer(&context, context.random_signer(), &indexer_url);

    let principal_asset_id = issue_asset(&borrower, BORROWER_PRINCIPAL_ASSET_SUPPLY)?;
    let offer = setup_pending_offer(
        &borrower,
        &pool,
        offer_params(
            &borrower,
            principal_asset_id,
            LIQUIDATION_LOAN_EXPIRATION_OFFSET,
        )?,
    )
    .await?;
    let offer_id = 1;
    assert_offer_status(&borrower, offer_id, OfferStatus::Pending).await?;

    fund_asset_outputs(
        &borrower,
        lender.signer(),
        principal_asset_id,
        &[TEST_PRINCIPAL_AMOUNT],
    )?;
    let (_, accept_txid) = accept_pending_offer(&lender, &pool, offer_id, &offer).await?;
    assert_offer_status(&borrower, offer_id, OfferStatus::Active).await?;

    fund_asset_outputs(&borrower, lender.signer(), principal_asset_id, &[1])?;
    context
        .get_network_utils()
        .mine_until_height((offer.parameters.offer_parameters.loan_expiration_time + 1) as u64)?;

    liquidate_active_offer(&lender, &pool, offer_id, accept_txid).await?;
    assert_offer_status(&borrower, offer_id, OfferStatus::Liquidated).await?;

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn claimed_principal_then_expired_offer_can_be_liquidated() -> anyhow::Result<()> {
    let (context, pool) = setup_it_context_pool().await?;
    let (indexer_url, server_handle) = start_indexer_api(pool.clone()).await?;
    let borrower = build_session(&context, &indexer_url);
    let lender = build_session_with_signer(&context, context.random_signer(), &indexer_url);

    let principal_asset_id = issue_asset(&borrower, BORROWER_PRINCIPAL_ASSET_SUPPLY)?;
    let offer = setup_pending_offer(
        &borrower,
        &pool,
        offer_params(
            &borrower,
            principal_asset_id,
            LIQUIDATION_LOAN_EXPIRATION_OFFSET,
        )?,
    )
    .await?;
    let offer_id = 1;
    assert_offer_status(&borrower, offer_id, OfferStatus::Pending).await?;

    fund_asset_outputs(
        &borrower,
        lender.signer(),
        principal_asset_id,
        &[TEST_PRINCIPAL_AMOUNT],
    )?;
    let (_, accept_txid) = accept_pending_offer(&lender, &pool, offer_id, &offer).await?;
    assert_offer_status(&borrower, offer_id, OfferStatus::Active).await?;

    claim_borrower_principal(&borrower, &pool, offer_id, &offer, accept_txid).await?;
    assert_offer_status(&borrower, offer_id, OfferStatus::Active).await?;

    fund_asset_outputs(&borrower, lender.signer(), principal_asset_id, &[1])?;
    context
        .get_network_utils()
        .mine_until_height((offer.parameters.offer_parameters.loan_expiration_time + 1) as u64)?;

    liquidate_active_offer(&lender, &pool, offer_id, accept_txid).await?;
    assert_offer_status(&borrower, offer_id, OfferStatus::Liquidated).await?;

    server_handle.abort();
    Ok(())
}
