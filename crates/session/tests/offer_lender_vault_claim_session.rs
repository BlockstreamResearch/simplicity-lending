mod utils;

use lending_contracts::programs::program::SimplexProgram;
use lending_indexer::indexer::update_offer_status;
use lending_session::SessionError;
use lending_session::indexer::{IndexerClient, OfferStatus, VaultType};
use serial_test::serial;

use utils::{
    DEFAULT_LOAN_EXPIRATION_OFFSET, TEST_PRINCIPAL_AMOUNT, accept_pending_offer,
    assert_offer_status, build_session, build_session_with_signer, claim_lender_vault,
    dummy_principal_asset_id, fund_asset_outputs, issue_asset, liquidate_active_offer,
    offer_params, repay_active_offer, setup_it_context_pool, setup_pending_offer,
    start_indexer_api,
};

const BORROWER_PRINCIPAL_ASSET_SUPPLY: u64 = 30_000;

#[tokio::test]
#[serial]
async fn repaid_offer_api_returns_lender_vault_for_claim() -> anyhow::Result<()> {
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

    fund_asset_outputs(
        &borrower,
        lender.signer(),
        principal_asset_id,
        &[TEST_PRINCIPAL_AMOUNT],
    )?;
    let (_, accept_txid) = accept_pending_offer(&lender, &pool, offer_id, &offer).await?;
    let repay_txid =
        repay_active_offer(&borrower, &pool, offer_id, accept_txid, &offer.parameters).await?;

    let expected_lender_amount = offer
        .parameters
        .offer_parameters
        .get_total_amount_to_repay()
        - offer.parameters.offer_parameters.get_total_protocol_fee();

    let client = IndexerClient::new(&indexer_url)?;
    let details = client.get_offer(&offer_id.to_string()).await?;

    assert_eq!(details.info.base.status, OfferStatus::Repaid);

    let lender_vault = details
        .vaults
        .iter()
        .find(|vault| vault.vault_type == VaultType::Lender && vault.is_finalized)
        .expect("repaid offer must expose finalized lender vault");
    assert_eq!(lender_vault.vout, 1);
    assert_eq!(lender_vault.txid, repay_txid.to_string());
    assert_eq!(lender_vault.amount, expected_lender_amount.to_string());

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn claim_lender_vault_burns_nft_and_unlocks_principal() -> anyhow::Result<()> {
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

    fund_asset_outputs(
        &borrower,
        lender.signer(),
        principal_asset_id,
        &[TEST_PRINCIPAL_AMOUNT],
    )?;
    let (_, accept_txid) = accept_pending_offer(&lender, &pool, offer_id, &offer).await?;
    repay_active_offer(&borrower, &pool, offer_id, accept_txid, &offer.parameters).await?;

    let expected_principal = offer
        .parameters
        .offer_parameters
        .get_total_amount_to_repay()
        - offer.parameters.offer_parameters.get_total_protocol_fee();
    let lender_vault = offer.parameters.get_lender_vault(0);

    assert!(
        !lender
            .signer()
            .get_provider()?
            .fetch_scripthash_utxos(&lender_vault.get_script_pubkey())?
            .is_empty(),
        "finalized lender vault must exist after repayment"
    );

    let claim_tx = lender.claim_lender_vault(&offer_id.to_string()).await?;

    assert_eq!(
        claim_tx.n_inputs(),
        2,
        "finalized lender vault + lender NFT"
    );
    assert_eq!(
        claim_tx.n_outputs(),
        2,
        "burned lender NFT + unlocked principal"
    );

    let outputs = claim_tx.outputs();
    assert_eq!(outputs[0].asset, offer.parameters.lender_nft_asset_id);
    assert_eq!(outputs[0].amount, 1);
    assert!(outputs[0].script_pubkey.is_op_return());
    assert_eq!(outputs[1].asset, offer.parameters.principal_asset_id);
    assert_eq!(outputs[1].amount, expected_principal);
    assert_eq!(
        outputs[1].script_pubkey,
        lender.signer().get_confidential_address().script_pubkey()
    );
    assert_eq!(
        outputs[1].blinding_key,
        Some(lender.signer().get_blinding_public_key())
    );

    let receipt = lender.signer().broadcast(&claim_tx)?;
    let claim_txid = receipt.txid();
    receipt.wait()?;

    assert!(
        lender
            .signer()
            .get_provider()?
            .fetch_scripthash_utxos(&lender_vault.get_script_pubkey())?
            .is_empty(),
        "finalized lender vault UTXO must be spent by the claim"
    );
    assert!(
        lender
            .signer()
            .get_utxos_asset(offer.parameters.lender_nft_asset_id)?
            .is_empty(),
        "lender NFT must be burned by the claim"
    );
    assert!(
        lender
            .signer()
            .get_utxos_asset(offer.parameters.principal_asset_id)?
            .iter()
            .any(|utxo| {
                utxo.outpoint.txid == claim_txid
                    && utxo.outpoint.vout == 1
                    && utxo.amount() == expected_principal
            }),
        "unlocked principal must return to the lender's wallet"
    );

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn claim_lender_vault_returns_offer_not_repaid_for_pending_offer() -> anyhow::Result<()> {
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

    let result = borrower.claim_lender_vault(&offer_id.to_string()).await;

    assert!(matches!(result, Err(SessionError::OfferNotRepaid)));

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn claim_lender_vault_returns_lender_vault_not_found_when_missing() -> anyhow::Result<()> {
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

    let mut sql_tx = pool.begin().await?;
    update_offer_status(&mut sql_tx, offer_id, OfferStatus::Repaid, 100).await?;
    sql_tx.commit().await?;

    let result = borrower.claim_lender_vault(&offer_id.to_string()).await;

    assert!(matches!(result, Err(SessionError::LenderVaultNotFound)));

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
async fn claim_lender_vault_fails_on_already_claimed_offer() -> anyhow::Result<()> {
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

    let result = lender.claim_lender_vault(&offer_id.to_string()).await;

    assert!(matches!(result, Err(SessionError::OfferNotRepaid)));
    assert_offer_status(&borrower, offer_id, OfferStatus::Claimed).await?;

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn claim_lender_vault_fails_on_liquidated_offer() -> anyhow::Result<()> {
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

    fund_asset_outputs(&borrower, lender.signer(), principal_asset_id, &[1])?;
    context
        .get_network_utils()
        .mine_until_height((offer.parameters.offer_parameters.loan_expiration_time + 1) as u64)?;

    liquidate_active_offer(&lender, &pool, offer_id, accept_txid).await?;
    assert_offer_status(&borrower, offer_id, OfferStatus::Liquidated).await?;

    let result = lender.claim_lender_vault(&offer_id.to_string()).await;

    assert!(matches!(result, Err(SessionError::OfferNotRepaid)));
    assert_offer_status(&borrower, offer_id, OfferStatus::Liquidated).await?;

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn borrower_cannot_claim_lender_vault_on_repaid_offer() -> anyhow::Result<()> {
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

    let result = borrower.claim_lender_vault(&offer_id.to_string()).await;

    assert!(matches!(result, Err(SessionError::LenderNftUtxoNotFound)));
    assert_offer_status(&borrower, offer_id, OfferStatus::Repaid).await?;

    server_handle.abort();
    Ok(())
}
