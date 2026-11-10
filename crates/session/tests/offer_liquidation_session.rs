mod utils;

use lending_contracts::programs::program::SimplexProgram;
use lending_indexer::models::OfferStatus;
use lending_session::{Session, SessionError};
use serial_test::serial;
use simplex::simplicityhl::elements::AssetId;
use sqlx::PgPool;

use utils::{
    DEFAULT_LOAN_EXPIRATION_OFFSET, OfferCreation, PartialRepayment, TEST_PRINCIPAL_AMOUNT,
    accept_pending_offer, assert_offer_status, build_session, build_session_with_signer,
    claim_lender_vault, dummy_principal_asset_id, fund_asset_outputs, issue_asset,
    liquidate_active_offer, offer_params, partially_repay_active_offer, repay_active_offer,
    setup_it_context_pool, setup_pending_offer, start_indexer_api,
};

const BORROWER_PRINCIPAL_ASSET_SUPPLY: u64 = 30_000;
const LIQUIDATION_LOAN_EXPIRATION_OFFSET: u32 = 20;
const PARTIAL_REPAYMENT_AMOUNT: u64 = 3_000;

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
                    && utxo.amount().unwrap() == offer.parameters.offer_parameters.collateral_amount
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

#[tokio::test]
#[serial]
async fn liquidate_offer_fails_on_repaid_offer() -> anyhow::Result<()> {
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

    repay_active_offer(&borrower, &pool, offer_id, accept_txid, &offer.parameters).await?;
    assert_offer_status(&borrower, offer_id, OfferStatus::Repaid).await?;

    let result = lender.liquidate_offer(&offer_id.to_string()).await;

    assert!(matches!(result, Err(SessionError::OfferNotActive)));
    assert_offer_status(&borrower, offer_id, OfferStatus::Repaid).await?;

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn liquidate_offer_fails_on_claimed_offer() -> anyhow::Result<()> {
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

    let result = lender.liquidate_offer(&offer_id.to_string()).await;

    assert!(matches!(result, Err(SessionError::OfferNotActive)));
    assert_offer_status(&borrower, offer_id, OfferStatus::Claimed).await?;

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn liquidate_offer_fails_when_already_liquidated() -> anyhow::Result<()> {
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

    let result = lender.liquidate_offer(&offer_id.to_string()).await;

    assert!(matches!(result, Err(SessionError::OfferNotActive)));
    assert_offer_status(&borrower, offer_id, OfferStatus::Liquidated).await?;

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn liquidate_offer_and_claim_lender_vault_empties_vault_in_one_transaction()
-> anyhow::Result<()> {
    let (context, pool) = setup_it_context_pool().await?;
    let (indexer_url, server_handle) = start_indexer_api(pool.clone()).await?;
    let borrower = build_session(&context, &indexer_url);
    let lender = build_session_with_signer(&context, context.random_signer(), &indexer_url);

    let PartiallyRepaidOffer {
        offer_id,
        offer,
        principal_asset_id,
        repayment,
    } = setup_partially_repaid_offer(&borrower, &lender, &pool).await?;

    fund_asset_outputs(&borrower, lender.signer(), principal_asset_id, &[1])?;

    mine_past_loan_expiration(&context, &offer)?;

    let liquidation_tx = lender
        .liquidate_offer_and_claim_lender_vault(&offer_id.to_string())
        .await?;

    assert_eq!(
        liquidation_tx.n_inputs(),
        3,
        "active offer + lender NFT + lender vault"
    );
    assert_eq!(liquidation_tx.n_outputs(), 3);

    let outputs = liquidation_tx.outputs();
    assert_eq!(outputs[0].asset, offer.parameters.lender_nft_asset_id);
    assert_eq!(outputs[0].amount, 1);
    assert!(outputs[0].script_pubkey.is_op_return());
    assert_eq!(outputs[1].asset, offer.parameters.collateral_asset_id);
    assert_eq!(outputs[1].amount, repayment.remaining_collateral);
    assert_eq!(
        outputs[1].script_pubkey,
        lender.signer().get_address().script_pubkey()
    );
    assert_eq!(outputs[2].asset, offer.parameters.principal_asset_id);
    assert_eq!(outputs[2].amount, repayment.lender_vault_amount);
    assert_eq!(
        outputs[2].script_pubkey,
        lender.signer().get_confidential_address().script_pubkey()
    );
    assert_eq!(
        outputs[2].blinding_key,
        Some(lender.signer().get_blinding_public_key())
    );

    let receipt = lender.signer().broadcast(&liquidation_tx)?;
    let liquidation_txid = receipt.txid();
    receipt.wait()?;

    let debt_after_repayment = offer
        .parameters
        .offer_parameters
        .get_total_amount_to_repay()
        - PARTIAL_REPAYMENT_AMOUNT;
    assert!(
        lender
            .signer()
            .get_provider()?
            .fetch_scripthash_utxos(
                &offer
                    .parameters
                    .get_lender_vault(debt_after_repayment)
                    .get_script_pubkey()
            )?
            .is_empty(),
        "active lender vault UTXO must be spent by the liquidation"
    );
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
            .get_utxos_asset(offer.parameters.principal_asset_id)?
            .iter()
            .any(|utxo| {
                utxo.outpoint.txid == liquidation_txid
                    && utxo.outpoint.vout == 2
                    && utxo.amount().unwrap() == repayment.lender_vault_amount
            }),
        "lender vault funds must return to the lender's wallet"
    );

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn liquidate_offer_and_claim_lender_vault_returns_loan_not_expired_before_expiration_height()
-> anyhow::Result<()> {
    let (context, pool) = setup_it_context_pool().await?;
    let (indexer_url, server_handle) = start_indexer_api(pool.clone()).await?;
    let borrower = build_session(&context, &indexer_url);
    let lender = build_session_with_signer(&context, context.random_signer(), &indexer_url);

    let PartiallyRepaidOffer { offer_id, .. } =
        setup_partially_repaid_offer(&borrower, &lender, &pool).await?;

    let result = lender
        .liquidate_offer_and_claim_lender_vault(&offer_id.to_string())
        .await;

    assert!(matches!(result, Err(SessionError::LoanNotExpired)));

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn liquidate_offer_and_claim_lender_vault_returns_lender_vault_not_found_without_repayments()
-> anyhow::Result<()> {
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

    fund_asset_outputs(
        &borrower,
        lender.signer(),
        principal_asset_id,
        &[TEST_PRINCIPAL_AMOUNT],
    )?;
    accept_pending_offer(&lender, &pool, offer_id, &offer).await?;

    mine_past_loan_expiration(&context, &offer)?;

    let result = lender
        .liquidate_offer_and_claim_lender_vault(&offer_id.to_string())
        .await;

    assert!(matches!(result, Err(SessionError::LenderVaultNotFound)));

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn liquidate_offer_and_claim_lender_vault_returns_offer_not_active_for_pending_offer()
-> anyhow::Result<()> {
    let (context, pool) = setup_it_context_pool().await?;
    let (indexer_url, server_handle) = start_indexer_api(pool.clone()).await?;
    let borrower = build_session(&context, &indexer_url);

    let principal_asset_id = issue_asset(&borrower, BORROWER_PRINCIPAL_ASSET_SUPPLY)?;
    let (offer_id, _) = setup_pending_offer(
        &borrower,
        &pool,
        offer_params(
            &borrower,
            principal_asset_id,
            LIQUIDATION_LOAN_EXPIRATION_OFFSET,
        )?,
    )
    .await?;

    let result = borrower
        .liquidate_offer_and_claim_lender_vault(&offer_id.to_string())
        .await;

    assert!(matches!(result, Err(SessionError::OfferNotActive)));

    server_handle.abort();
    Ok(())
}

// A plain liquidation would burn the Lender NFT and leave the active vault without a keeper.
#[tokio::test]
#[serial]
async fn liquidate_offer_refuses_partially_repaid_offer() -> anyhow::Result<()> {
    let (context, pool) = setup_it_context_pool().await?;
    let (indexer_url, server_handle) = start_indexer_api(pool.clone()).await?;
    let borrower = build_session(&context, &indexer_url);
    let lender = build_session_with_signer(&context, context.random_signer(), &indexer_url);

    let PartiallyRepaidOffer {
        offer_id, offer, ..
    } = setup_partially_repaid_offer(&borrower, &lender, &pool).await?;

    mine_past_loan_expiration(&context, &offer)?;

    let result = lender.liquidate_offer(&offer_id.to_string()).await;

    assert!(matches!(result, Err(SessionError::ActiveOfferUtxoNotFound)));

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn borrower_cannot_liquidate_offer_and_claim_lender_vault() -> anyhow::Result<()> {
    let (context, pool) = setup_it_context_pool().await?;
    let (indexer_url, server_handle) = start_indexer_api(pool.clone()).await?;
    let borrower = build_session(&context, &indexer_url);
    let lender = build_session_with_signer(&context, context.random_signer(), &indexer_url);

    let PartiallyRepaidOffer {
        offer_id, offer, ..
    } = setup_partially_repaid_offer(&borrower, &lender, &pool).await?;

    mine_past_loan_expiration(&context, &offer)?;

    let result = borrower
        .liquidate_offer_and_claim_lender_vault(&offer_id.to_string())
        .await;

    assert!(matches!(result, Err(SessionError::LenderNftUtxoNotFound)));

    server_handle.abort();
    Ok(())
}

struct PartiallyRepaidOffer {
    offer_id: i64,
    offer: OfferCreation,
    principal_asset_id: AssetId,
    repayment: PartialRepayment,
}

/// Creates an offer, has `lender` accept it and `borrower` repay `PARTIAL_REPAYMENT_AMOUNT` of it,
/// which leaves an active lender vault behind.
async fn setup_partially_repaid_offer(
    borrower: &Session,
    lender: &Session,
    pool: &PgPool,
) -> anyhow::Result<PartiallyRepaidOffer> {
    let principal_asset_id = issue_asset(borrower, BORROWER_PRINCIPAL_ASSET_SUPPLY)?;
    let (offer_id, offer) = setup_pending_offer(
        borrower,
        pool,
        offer_params(
            borrower,
            principal_asset_id,
            LIQUIDATION_LOAN_EXPIRATION_OFFSET,
        )?,
    )
    .await?;

    fund_asset_outputs(
        borrower,
        lender.signer(),
        principal_asset_id,
        &[TEST_PRINCIPAL_AMOUNT],
    )?;
    let (_, accept_txid) = accept_pending_offer(lender, pool, offer_id, &offer).await?;

    let repayment = partially_repay_active_offer(
        borrower,
        pool,
        offer_id,
        accept_txid,
        &offer.parameters,
        PARTIAL_REPAYMENT_AMOUNT,
    )
    .await?;
    assert!(repayment.lender_vault_amount > 0);
    assert!(repayment.remaining_collateral < offer.parameters.offer_parameters.collateral_amount);

    Ok(PartiallyRepaidOffer {
        offer_id,
        offer,
        principal_asset_id,
        repayment,
    })
}

fn mine_past_loan_expiration(
    context: &simplex::TestContext,
    offer: &OfferCreation,
) -> anyhow::Result<()> {
    context
        .get_network_utils()
        .mine_until_height((offer.parameters.offer_parameters.loan_expiration_time + 1) as u64)?;
    Ok(())
}
