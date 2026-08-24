#[path = "../utils/mod.rs"]
mod utils;

use std::collections::HashMap;

use anyhow::Context;
use lending_indexer::models::OfferStatus;
use lending_session::{Session, SessionError};
use serial_test::serial;
use simplex::simplicityhl::elements::AssetId;
use simplex::simplicityhl::elements::hex::ToHex;
use sqlx::PgPool;
use uuid::Uuid;

use utils::{
    DEFAULT_LOAN_EXPIRATION_OFFSET, IndexedFactoryState, OfferCreation, TEST_PRINCIPAL_AMOUNT,
    accept_pending_offer, assert_offer_status, build_session, build_session_with_signer,
    cancel_pending_offer, claim_borrower_principal, claim_lender_vault, create_active_factory,
    dummy_principal_asset_id, fund_asset_outputs, fund_policy_output, issue_asset,
    liquidate_active_offer, offer_params, remove_factory_and_index_it, repay_active_offer,
    setup_it_context_pool, setup_pending_offer, setup_pending_offer_with_existing_factory,
    start_indexer_api, transfer_factory_auth_and_index,
};

const BORROWER_PRINCIPAL_ASSET_SUPPLY: u64 = 30_000;
const LIQUIDATION_LOAN_EXPIRATION_OFFSET: u32 = 20;

async fn setup_pending_offer_using_first_active_factory(
    borrower: &Session,
    pool: &PgPool,
    factories: &mut HashMap<Uuid, IndexedFactoryState>,
    principal_asset_id: AssetId,
) -> anyhow::Result<(i64, OfferCreation, Uuid)> {
    let borrower_script_hex = borrower.signer().get_address().script_pubkey().to_hex();
    let factory_id = borrower
        .indexer()
        .get_factories_by_script(&borrower_script_hex)
        .await?
        .into_iter()
        .next()
        .context("expected at least one active factory for borrower")?
        .id;
    let factory = factories
        .get_mut(&factory_id)
        .context("active factory missing in in-memory tracking map")?;
    let (offer_id, offer) = setup_pending_offer_with_existing_factory(
        borrower,
        pool,
        factory,
        principal_asset_id,
        DEFAULT_LOAN_EXPIRATION_OFFSET,
    )
    .await?;
    Ok((offer_id, offer, factory_id))
}

#[tokio::test]
#[serial]
async fn full_loan_cycle_with_claim_principal_completes_to_claimed() -> anyhow::Result<()> {
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
    let (_, accept_txid) = accept_pending_offer(&lender, &pool, offer_id, &offer).await?;
    assert_offer_status(&borrower, offer_id, OfferStatus::Active).await?;

    claim_borrower_principal(&borrower, &pool, offer_id, &offer, accept_txid).await?;
    assert_offer_status(&borrower, offer_id, OfferStatus::Active).await?;

    let repay_txid =
        repay_active_offer(&borrower, &pool, offer_id, accept_txid, &offer.parameters).await?;
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
    let (_, accept_txid) = accept_pending_offer(&lender, &pool, offer_id, &offer).await?;
    assert_offer_status(&borrower, offer_id, OfferStatus::Active).await?;

    let repay_txid =
        repay_active_offer(&borrower, &pool, offer_id, accept_txid, &offer.parameters).await?;
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

#[tokio::test]
#[serial]
async fn same_factory_supports_two_sequential_full_loan_cycles() -> anyhow::Result<()> {
    let (context, pool) = setup_it_context_pool().await?;
    let (indexer_url, server_handle) = start_indexer_api(pool.clone()).await?;
    let borrower = build_session(&context, &indexer_url);
    let lender = build_session_with_signer(&context, context.random_signer(), &indexer_url);

    let mut factory = create_active_factory(&borrower, &pool).await?;
    let principal_asset_id = issue_asset(&borrower, BORROWER_PRINCIPAL_ASSET_SUPPLY)?;

    for _ in 0..2 {
        let (offer_id, offer) = setup_pending_offer_with_existing_factory(
            &borrower,
            &pool,
            &mut factory,
            principal_asset_id,
            DEFAULT_LOAN_EXPIRATION_OFFSET,
        )
        .await?;
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
        let repay_txid =
            repay_active_offer(&borrower, &pool, offer_id, accept_txid, &offer.parameters).await?;
        assert_offer_status(&borrower, offer_id, OfferStatus::Repaid).await?;

        claim_lender_vault(&lender, &pool, offer_id, accept_txid, repay_txid).await?;
        assert_offer_status(&borrower, offer_id, OfferStatus::Claimed).await?;
    }

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn parallel_pending_offers_cancel_one_does_not_block_the_other() -> anyhow::Result<()> {
    let (context, pool) = setup_it_context_pool().await?;
    let (indexer_url, server_handle) = start_indexer_api(pool.clone()).await?;
    let borrower = build_session(&context, &indexer_url);
    let lender = build_session_with_signer(&context, context.random_signer(), &indexer_url);

    let mut factory = create_active_factory(&borrower, &pool).await?;
    let principal_asset_id = issue_asset(&borrower, BORROWER_PRINCIPAL_ASSET_SUPPLY)?;

    let (offer_a_id, offer_a) = setup_pending_offer_with_existing_factory(
        &borrower,
        &pool,
        &mut factory,
        principal_asset_id,
        DEFAULT_LOAN_EXPIRATION_OFFSET,
    )
    .await?;
    let (offer_b_id, offer_b) = setup_pending_offer_with_existing_factory(
        &borrower,
        &pool,
        &mut factory,
        principal_asset_id,
        DEFAULT_LOAN_EXPIRATION_OFFSET,
    )
    .await?;
    assert_offer_status(&borrower, offer_a_id, OfferStatus::Pending).await?;
    assert_offer_status(&borrower, offer_b_id, OfferStatus::Pending).await?;

    cancel_pending_offer(&borrower, &pool, offer_a_id, &offer_a).await?;
    assert_offer_status(&borrower, offer_a_id, OfferStatus::Cancelled).await?;
    assert_offer_status(&borrower, offer_b_id, OfferStatus::Pending).await?;

    fund_asset_outputs(
        &borrower,
        lender.signer(),
        principal_asset_id,
        &[TEST_PRINCIPAL_AMOUNT],
    )?;
    let (_, accept_txid) = accept_pending_offer(&lender, &pool, offer_b_id, &offer_b).await?;
    claim_borrower_principal(&borrower, &pool, offer_b_id, &offer_b, accept_txid).await?;
    let repay_txid = repay_active_offer(
        &borrower,
        &pool,
        offer_b_id,
        accept_txid,
        &offer_b.parameters,
    )
    .await?;
    claim_lender_vault(&lender, &pool, offer_b_id, accept_txid, repay_txid).await?;

    assert_offer_status(&borrower, offer_b_id, OfferStatus::Claimed).await?;
    assert_offer_status(&borrower, offer_a_id, OfferStatus::Cancelled).await?;

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn transferred_factory_auth_allows_create_offer_and_remove() -> anyhow::Result<()> {
    let (context, pool) = setup_it_context_pool().await?;
    let (indexer_url, server_handle) = start_indexer_api(pool.clone()).await?;
    let factory_owner = build_session(&context, &indexer_url);
    let borrower = build_session_with_signer(&context, context.random_signer(), &indexer_url);

    fund_policy_output(&factory_owner, borrower.signer(), 1_000_000)?;

    let mut factory = create_active_factory(&factory_owner, &pool).await?;
    transfer_factory_auth_and_index(&factory_owner, &borrower, &pool, &mut factory).await?;

    let principal_asset_id = issue_asset(&borrower, BORROWER_PRINCIPAL_ASSET_SUPPLY)?;
    let (offer_id, offer) = setup_pending_offer_with_existing_factory(
        &borrower,
        &pool,
        &mut factory,
        principal_asset_id,
        DEFAULT_LOAN_EXPIRATION_OFFSET,
    )
    .await?;
    assert_offer_status(&borrower, offer_id, OfferStatus::Pending).await?;

    cancel_pending_offer(&borrower, &pool, offer_id, &offer).await?;
    assert_offer_status(&borrower, offer_id, OfferStatus::Cancelled).await?;

    remove_factory_and_index_it(&borrower, &pool, &factory).await?;
    let borrower_script_hex = borrower.signer().get_address().script_pubkey().to_hex();
    let factories_after_remove = borrower
        .indexer()
        .get_factories_by_script(&borrower_script_hex)
        .await?;
    assert!(
        factories_after_remove.is_empty(),
        "borrower should have no active factories after removal"
    );

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn remove_factories_interleaved_with_create_offer() -> anyhow::Result<()> {
    let (context, pool) = setup_it_context_pool().await?;
    let (indexer_url, server_handle) = start_indexer_api(pool.clone()).await?;
    let borrower = build_session(&context, &indexer_url);
    let donor_a = build_session_with_signer(&context, context.random_signer(), &indexer_url);
    let donor_b = build_session_with_signer(&context, context.random_signer(), &indexer_url);
    let donor_c = build_session_with_signer(&context, context.random_signer(), &indexer_url);

    for donor in [&donor_a, &donor_b, &donor_c] {
        fund_policy_output(&borrower, donor.signer(), 1_000_000)?;
    }

    let mut factories = HashMap::<Uuid, IndexedFactoryState>::new();
    for donor in [&donor_a, &donor_b, &donor_c] {
        let mut factory = create_active_factory(donor, &pool).await?;
        transfer_factory_auth_and_index(donor, &borrower, &pool, &mut factory).await?;
        factories.insert(factory.id, factory);
    }

    let principal_asset_id = issue_asset(&borrower, BORROWER_PRINCIPAL_ASSET_SUPPLY)?;

    for _ in 0..3 {
        let borrower_script_hex = borrower.signer().get_address().script_pubkey().to_hex();
        let active_before_remove = borrower
            .indexer()
            .get_factories_by_script(&borrower_script_hex)
            .await?;
        let to_remove = active_before_remove
            .first()
            .context("expected active factory before remove")?;
        let removing_factory = factories
            .remove(&to_remove.id)
            .context("removing factory not found in in-memory map")?;
        remove_factory_and_index_it(&borrower, &pool, &removing_factory).await?;

        if !factories.is_empty() {
            let (offer_id, offer, _) = setup_pending_offer_using_first_active_factory(
                &borrower,
                &pool,
                &mut factories,
                principal_asset_id,
            )
            .await?;
            assert_offer_status(&borrower, offer_id, OfferStatus::Pending).await?;
            cancel_pending_offer(&borrower, &pool, offer_id, &offer).await?;
            assert_offer_status(&borrower, offer_id, OfferStatus::Cancelled).await?;
        }
    }

    let borrower_script_hex = borrower.signer().get_address().script_pubkey().to_hex();
    let active_after_all_removes = borrower
        .indexer()
        .get_factories_by_script(&borrower_script_hex)
        .await?;
    assert!(
        active_after_all_removes.is_empty(),
        "all borrower factories should be removed"
    );

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn recreate_factory_after_remove_allows_create_offer() -> anyhow::Result<()> {
    let (context, pool) = setup_it_context_pool().await?;
    let (indexer_url, server_handle) = start_indexer_api(pool.clone()).await?;
    let borrower = build_session(&context, &indexer_url);

    let first_factory = create_active_factory(&borrower, &pool).await?;
    remove_factory_and_index_it(&borrower, &pool, &first_factory).await?;

    let mut second_factory = create_active_factory(&borrower, &pool).await?;
    let principal_asset_id = issue_asset(&borrower, BORROWER_PRINCIPAL_ASSET_SUPPLY)?;
    let (offer_id, _) = setup_pending_offer_with_existing_factory(
        &borrower,
        &pool,
        &mut second_factory,
        principal_asset_id,
        DEFAULT_LOAN_EXPIRATION_OFFSET,
    )
    .await?;
    assert_offer_status(&borrower, offer_id, OfferStatus::Pending).await?;

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn claim_principal_fails_on_pending_offer() -> anyhow::Result<()> {
    let (context, pool) = setup_it_context_pool().await?;
    let (indexer_url, server_handle) = start_indexer_api(pool.clone()).await?;
    let borrower = build_session(&context, &indexer_url);

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

    let result = borrower.claim_principal(&offer_id.to_string()).await;

    assert!(matches!(result, Err(SessionError::OfferNotActive)));
    assert_offer_status(&borrower, offer_id, OfferStatus::Pending).await?;

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn repay_offer_fails_on_pending_offer() -> anyhow::Result<()> {
    let (context, pool) = setup_it_context_pool().await?;
    let (indexer_url, server_handle) = start_indexer_api(pool.clone()).await?;
    let borrower = build_session(&context, &indexer_url);

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

    let result = borrower.repay_offer(&offer_id.to_string()).await;

    assert!(matches!(result, Err(SessionError::OfferNotActive)));
    assert_offer_status(&borrower, offer_id, OfferStatus::Pending).await?;

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
async fn claim_lender_vault_fails_on_pending_offer() -> anyhow::Result<()> {
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

    let result = lender.claim_lender_vault(&offer_id.to_string()).await;

    assert!(matches!(result, Err(SessionError::OfferNotRepaid)));
    assert_offer_status(&borrower, offer_id, OfferStatus::Pending).await?;

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
async fn accept_offer_fails_on_already_active_offer() -> anyhow::Result<()> {
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

    let result = lender.accept_offer(&offer_id.to_string()).await;

    assert!(matches!(result, Err(SessionError::OfferNotPending)));
    assert_offer_status(&borrower, offer_id, OfferStatus::Active).await?;

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn claim_lender_vault_fails_on_active_offer() -> anyhow::Result<()> {
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

    let result = lender.claim_lender_vault(&offer_id.to_string()).await;

    assert!(matches!(result, Err(SessionError::OfferNotRepaid)));
    assert_offer_status(&borrower, offer_id, OfferStatus::Active).await?;

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
