mod utils;

use lending_contracts::programs::lending::LendingOfferParameters;
use lending_contracts::programs::program::SimplexProgram;
use lending_indexer::indexer::update_offer_status;
use lending_indexer::models::OfferStatus;
use lending_session::SessionError;
use serial_test::serial;

use utils::{
    DEFAULT_LOAN_EXPIRATION_OFFSET, TEST_PRINCIPAL_AMOUNT, build_session,
    build_session_with_signer, fund_asset_outputs, issue_asset, offer_params,
    setup_it_context_pool, setup_pending_offer, start_indexer_api,
};

const PRINCIPAL_PARTS: [u64; 2] = [6_000, 5_000];

fn assert_acceptance_tx_shape(
    accept: &lending_session::AcceptOfferTx,
    parameters: &LendingOfferParameters,
    principal_input_count: usize,
    expected_change: Option<u64>,
) {
    assert!(accept.active_offer.is_active_offer());
    assert_eq!(
        accept.transaction.n_inputs(),
        2 + principal_input_count,
        "pending offer + lender NFT + principal inputs"
    );

    let expected_outputs = 3 + usize::from(expected_change.is_some());
    assert_eq!(accept.transaction.n_outputs(), expected_outputs);

    let outputs = accept.transaction.outputs();
    assert_eq!(outputs[0].asset, parameters.collateral_asset_id);
    assert_eq!(
        outputs[0].amount,
        parameters.offer_parameters.collateral_amount
    );
    assert_eq!(outputs[1].asset, parameters.principal_asset_id);
    assert_eq!(
        outputs[1].amount,
        parameters.offer_parameters.principal_amount
    );
    assert_eq!(outputs[2].asset, parameters.lender_nft_asset_id);
    assert_eq!(outputs[2].amount, 1);

    if let Some(change) = expected_change {
        assert_eq!(outputs[3].asset, parameters.principal_asset_id);
        assert_eq!(outputs[3].amount, change);
    }
}

#[tokio::test]
#[serial]
async fn accept_offer_selects_multiple_principal_utxos_and_activates_offer() -> anyhow::Result<()> {
    let (context, pool) = setup_it_context_pool().await?;
    let (indexer_url, server_handle) = start_indexer_api(pool.clone()).await?;
    let borrower = build_session(&context, &indexer_url);
    let lender_signer = context.random_signer();
    let lender = build_session_with_signer(&context, lender_signer, &indexer_url);

    let principal_asset_id = issue_asset(&borrower, 20_000)?;
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

    fund_asset_outputs(
        &borrower,
        lender.signer(),
        principal_asset_id,
        &PRINCIPAL_PARTS,
    )?;

    let lender_principal_before = lender.signer().get_utxos_asset(principal_asset_id)?;
    assert_eq!(
        lender_principal_before.len(),
        PRINCIPAL_PARTS.len(),
        "lender must hold multiple principal UTXOs"
    );
    assert!(
        lender_principal_before
            .iter()
            .all(|utxo| utxo.amount() < TEST_PRINCIPAL_AMOUNT),
        "no single UTXO should cover the principal alone"
    );
    assert_eq!(
        lender_principal_before
            .iter()
            .map(|utxo| utxo.amount())
            .sum::<u64>(),
        PRINCIPAL_PARTS.iter().sum::<u64>()
    );

    let accept = lender.accept_offer("1").await?;
    let expected_change =
        PRINCIPAL_PARTS.iter().sum::<u64>() - offer.parameters.offer_parameters.principal_amount;

    assert_acceptance_tx_shape(
        &accept,
        &offer.parameters,
        PRINCIPAL_PARTS.len(),
        Some(expected_change),
    );
    assert_eq!(
        accept.transaction.outputs()[2].script_pubkey,
        lender.signer().get_address().script_pubkey()
    );

    let receipt = lender.signer().broadcast(&accept.transaction)?;
    let accept_txid = receipt.txid();
    receipt.wait()?;

    assert!(
        borrower
            .signer()
            .get_provider()
            .fetch_scripthash_utxos(&accept.active_offer.get_script_pubkey())?
            .iter()
            .any(|utxo| utxo.outpoint.txid == accept_txid),
        "active offer covenant must be created on-chain"
    );

    let principal_auth = offer.parameters.get_principal_output_asset_auth();
    assert!(
        borrower
            .signer()
            .get_provider()
            .fetch_scripthash_utxos(&principal_auth.get_script_pubkey())?
            .iter()
            .any(|utxo| {
                utxo.outpoint.txid == accept_txid
                    && utxo.amount() == TEST_PRINCIPAL_AMOUNT
                    && utxo.asset() == principal_asset_id
            }),
        "borrower principal must be locked under AssetAuth"
    );

    assert!(
        !lender
            .signer()
            .get_utxos_asset(offer.parameters.lender_nft_asset_id)?
            .is_empty(),
        "lender must receive the lender NFT"
    );
    assert!(
        lender
            .signer()
            .get_utxos_asset(principal_asset_id)?
            .iter()
            .any(|utxo| { utxo.outpoint.txid == accept_txid && utxo.amount() == expected_change }),
        "principal change must return to the lender wallet"
    );

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn accept_offer_returns_offer_not_pending_for_active_offer() -> anyhow::Result<()> {
    let (context, pool) = setup_it_context_pool().await?;
    let (indexer_url, server_handle) = start_indexer_api(pool.clone()).await?;
    let borrower = build_session(&context, &indexer_url);
    let lender = build_session_with_signer(&context, context.random_signer(), &indexer_url);

    let principal_asset_id = issue_asset(&borrower, 20_000)?;
    setup_pending_offer(
        &borrower,
        &pool,
        offer_params(
            &borrower,
            principal_asset_id,
            DEFAULT_LOAN_EXPIRATION_OFFSET,
        )?,
    )
    .await?;

    let mut sql_tx = pool.begin().await?;
    update_offer_status(&mut sql_tx, 1, OfferStatus::Active, 100).await?;
    sql_tx.commit().await?;

    let result = lender.accept_offer("1").await;

    assert!(matches!(result, Err(SessionError::OfferNotPending)));

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn accept_offer_returns_principal_utxo_not_found_without_funds() -> anyhow::Result<()> {
    let (context, pool) = setup_it_context_pool().await?;
    let (indexer_url, server_handle) = start_indexer_api(pool.clone()).await?;
    let borrower = build_session(&context, &indexer_url);
    let lender = build_session_with_signer(&context, context.random_signer(), &indexer_url);

    let principal_asset_id = issue_asset(&borrower, 20_000)?;
    setup_pending_offer(
        &borrower,
        &pool,
        offer_params(
            &borrower,
            principal_asset_id,
            DEFAULT_LOAN_EXPIRATION_OFFSET,
        )?,
    )
    .await?;

    let result = lender.accept_offer("1").await;

    assert!(matches!(result, Err(SessionError::PrincipalUtxoNotFound)));

    server_handle.abort();
    Ok(())
}
