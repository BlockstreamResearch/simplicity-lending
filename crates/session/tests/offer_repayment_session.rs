mod utils;

use lending_contracts::programs::program::SimplexProgram;
use lending_session::SessionError;
use serial_test::serial;

use utils::{
    DEFAULT_LOAN_EXPIRATION_OFFSET, TEST_PRINCIPAL_AMOUNT, accept_pending_offer, build_session,
    build_session_with_signer, dummy_principal_asset_id, fund_asset_outputs, issue_asset,
    offer_params, setup_it_context_pool, setup_pending_offer, start_indexer_api,
};

const BORROWER_PRINCIPAL_ASSET_SUPPLY: u64 = 30_000;

#[tokio::test]
#[serial]
async fn repay_offer_burns_borrower_nft_and_returns_collateral_to_borrower() -> anyhow::Result<()> {
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

    fund_asset_outputs(
        &borrower,
        lender.signer(),
        principal_asset_id,
        &[TEST_PRINCIPAL_AMOUNT],
    )?;
    accept_pending_offer(&lender, &pool, 1, &offer).await?;

    let borrower_principal_before = borrower
        .signer()
        .get_utxos_asset(principal_asset_id)?
        .into_iter()
        .next()
        .expect("borrower must hold leftover principal asset after funding the lender")
        .explicit_amount();

    let total_amount_to_repay = offer
        .parameters
        .offer_parameters
        .get_total_amount_to_repay();
    let total_protocol_fee = offer.parameters.offer_parameters.get_total_protocol_fee();
    let expected_lender_vault_amount = total_amount_to_repay - total_protocol_fee;
    let expected_change = borrower_principal_before - total_amount_to_repay;

    assert!(borrower_principal_before >= total_amount_to_repay);

    let repay_tx = borrower.repay_offer("1").await?;

    assert_eq!(
        repay_tx.n_inputs(),
        3,
        "borrower NFT + active offer + principal"
    );
    assert_eq!(
        repay_tx.n_outputs(),
        5,
        "burned NFT + lender vault + protocol fee vault + collateral + principal change"
    );

    let outputs = repay_tx.outputs();
    assert_eq!(outputs[0].asset, offer.parameters.borrower_nft_asset_id);
    assert_eq!(outputs[0].amount, 1);
    assert!(outputs[0].script_pubkey.is_op_return());

    assert_eq!(outputs[1].asset, offer.parameters.principal_asset_id);
    assert_eq!(outputs[1].amount, expected_lender_vault_amount);
    assert_eq!(
        outputs[1].script_pubkey,
        offer
            .parameters
            .get_finalized_lender_vault()
            .get_script_pubkey()
    );

    assert_eq!(outputs[2].asset, offer.parameters.principal_asset_id);
    assert_eq!(outputs[2].amount, total_protocol_fee);
    assert_eq!(
        outputs[2].script_pubkey,
        offer
            .parameters
            .get_finalized_protocol_fee_vault()
            .get_script_pubkey()
    );

    assert_eq!(outputs[3].asset, offer.parameters.collateral_asset_id);
    assert_eq!(
        outputs[3].amount,
        offer.parameters.offer_parameters.collateral_amount
    );
    assert_eq!(
        outputs[3].script_pubkey,
        borrower.signer().get_confidential_address().script_pubkey()
    );
    assert_eq!(
        outputs[3].blinding_key,
        Some(borrower.signer().get_blinding_public_key())
    );

    assert_eq!(outputs[4].asset, offer.parameters.principal_asset_id);
    assert_eq!(outputs[4].amount, expected_change);
    assert_eq!(
        outputs[4].script_pubkey,
        borrower.signer().get_address().script_pubkey()
    );

    let receipt = borrower.signer().broadcast(&repay_tx)?;
    let repay_txid = receipt.txid();
    receipt.wait()?;

    assert!(
        borrower
            .signer()
            .get_utxos_asset(offer.parameters.borrower_nft_asset_id)?
            .is_empty(),
        "borrower NFT must be burned by the repayment"
    );
    assert!(
        borrower
            .signer()
            .get_utxos_asset(offer.parameters.collateral_asset_id)?
            .iter()
            .any(|utxo| {
                utxo.outpoint.txid == repay_txid
                    && utxo.outpoint.vout == 3
                    && utxo.amount() == offer.parameters.offer_parameters.collateral_amount
            }),
        "collateral must be returned to the borrower's wallet"
    );
    assert!(
        borrower
            .signer()
            .get_provider()
            .fetch_scripthash_utxos(
                &offer
                    .parameters
                    .get_finalized_lender_vault()
                    .get_script_pubkey()
            )?
            .iter()
            .any(|utxo| {
                utxo.outpoint.txid == repay_txid
                    && utxo.explicit_amount() == expected_lender_vault_amount
            }),
        "lender vault must be finalized with the repaid principal and fee"
    );
    assert!(
        borrower
            .signer()
            .get_provider()
            .fetch_scripthash_utxos(
                &offer
                    .parameters
                    .get_finalized_protocol_fee_vault()
                    .get_script_pubkey()
            )?
            .iter()
            .any(|utxo| {
                utxo.outpoint.txid == repay_txid && utxo.explicit_amount() == total_protocol_fee
            }),
        "protocol fee vault must be finalized with the repaid protocol fee"
    );

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn repay_offer_returns_offer_not_active_for_pending_offer() -> anyhow::Result<()> {
    let (context, pool) = setup_it_context_pool().await?;
    let (indexer_url, server_handle) = start_indexer_api(pool.clone()).await?;
    let borrower = build_session(&context, &indexer_url);

    setup_pending_offer(
        &borrower,
        &pool,
        offer_params(
            &borrower,
            dummy_principal_asset_id(),
            DEFAULT_LOAN_EXPIRATION_OFFSET,
        )?,
    )
    .await?;

    let result = borrower.repay_offer("1").await;

    assert!(matches!(result, Err(SessionError::OfferNotActive)));

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn repay_offer_returns_principal_utxo_not_found_without_funds() -> anyhow::Result<()> {
    let (context, pool) = setup_it_context_pool().await?;
    let (indexer_url, server_handle) = start_indexer_api(pool.clone()).await?;
    let borrower = build_session(&context, &indexer_url);
    let lender = build_session_with_signer(&context, context.random_signer(), &indexer_url);

    let principal_asset_id = issue_asset(&borrower, TEST_PRINCIPAL_AMOUNT)?;
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
        &[TEST_PRINCIPAL_AMOUNT],
    )?;
    accept_pending_offer(&lender, &pool, 1, &offer).await?;

    assert!(
        borrower
            .signer()
            .get_utxos_asset(principal_asset_id)?
            .is_empty(),
        "borrower must have spent the entire principal asset supply funding the lender"
    );

    let result = borrower.repay_offer("1").await;

    assert!(matches!(result, Err(SessionError::PrincipalUtxoNotFound)));

    server_handle.abort();
    Ok(())
}
