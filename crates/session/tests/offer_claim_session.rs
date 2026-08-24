mod utils;

use lending_contracts::programs::program::SimplexProgram;
use lending_indexer::indexer::update_offer_status;
use lending_indexer::models::OfferStatus;
use lending_session::SessionError;
use serial_test::serial;

use utils::{
    DEFAULT_LOAN_EXPIRATION_OFFSET, TEST_PRINCIPAL_AMOUNT, accept_pending_offer, build_session,
    build_session_with_signer, dummy_principal_asset_id, fund_asset_outputs, issue_asset,
    offer_params, setup_it_context_pool, setup_pending_offer, start_indexer_api,
};

#[tokio::test]
#[serial]
async fn claim_principal_unlocks_principal_and_returns_borrower_nft() -> anyhow::Result<()> {
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
    accept_pending_offer(&lender, &pool, offer_id, &offer).await?;

    let principal_auth = offer.parameters.get_principal_output_asset_auth();
    assert!(
        !borrower
            .signer()
            .get_provider()?
            .fetch_scripthash_utxos(&principal_auth.get_script_pubkey())?
            .is_empty(),
        "borrower principal must be locked under AssetAuth after acceptance"
    );

    let claim_tx = borrower.claim_principal(&offer_id.to_string()).await?;

    assert_eq!(claim_tx.n_inputs(), 2, "AssetAuth principal + borrower NFT");
    assert_eq!(claim_tx.n_outputs(), 2, "borrower NFT + unlocked principal");

    let outputs = claim_tx.outputs();
    assert_eq!(outputs[0].asset, offer.parameters.borrower_nft_asset_id);
    assert_eq!(outputs[0].amount, 1);
    assert_eq!(
        outputs[0].script_pubkey,
        borrower.signer().get_address().script_pubkey()
    );
    assert_eq!(outputs[1].asset, offer.parameters.principal_asset_id);
    assert_eq!(
        outputs[1].amount,
        offer.parameters.offer_parameters.principal_amount
    );
    assert_eq!(
        outputs[1].script_pubkey,
        borrower.signer().get_confidential_address().script_pubkey()
    );
    assert_eq!(
        outputs[1].blinding_key,
        Some(borrower.signer().get_blinding_public_key())
    );

    let receipt = borrower.signer().broadcast(&claim_tx)?;
    let claim_txid = receipt.txid();
    receipt.wait()?;

    assert!(
        borrower
            .signer()
            .get_provider()?
            .fetch_scripthash_utxos(&principal_auth.get_script_pubkey())?
            .is_empty(),
        "AssetAuth principal UTXO must be spent by the claim"
    );
    assert!(
        borrower
            .signer()
            .get_utxos_asset(offer.parameters.borrower_nft_asset_id)?
            .iter()
            .any(|utxo| utxo.outpoint.txid == claim_txid && utxo.outpoint.vout == 0),
        "borrower NFT must return to the borrower's wallet"
    );
    assert!(
        borrower
            .signer()
            .get_utxos_asset(offer.parameters.principal_asset_id)?
            .iter()
            .any(|utxo| {
                utxo.outpoint.txid == claim_txid
                    && utxo.outpoint.vout == 1
                    && utxo.amount() == TEST_PRINCIPAL_AMOUNT
            }),
        "unlocked principal must return to the borrower's wallet"
    );

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn claim_principal_returns_offer_not_active_for_pending_offer() -> anyhow::Result<()> {
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

    let result = borrower.claim_principal(&offer_id.to_string()).await;

    assert!(matches!(result, Err(SessionError::OfferNotActive)));

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn claim_principal_returns_borrower_principal_utxo_not_found_when_missing()
-> anyhow::Result<()> {
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
    update_offer_status(&mut sql_tx, offer_id, OfferStatus::Active, 100).await?;
    sql_tx.commit().await?;

    let result = borrower.claim_principal(&offer_id.to_string()).await;

    assert!(matches!(
        result,
        Err(SessionError::BorrowerPrincipalUtxoNotFound)
    ));

    server_handle.abort();
    Ok(())
}
