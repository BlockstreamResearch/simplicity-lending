mod common;

use common::test_pool;
use common::vault_tracking::{
    FIRST_PARTIAL_AMOUNT, SECOND_PARTIAL_AMOUNT, TRACKABLE_REPAYMENT_HEIGHT,
    build_first_partial_repayment_tx, build_full_repayment_tx, build_lender_vault_withdraw_all_tx,
    build_second_partial_repayment_tx, fetch_active_vault_rows, fetch_offer_status, load_registry,
    offer_lending_params, process_tx_through_registry, seed_minimal_factory,
    seed_trackable_active_offer,
};
use lending_indexer::models::{OfferStatus, UtxoType, VaultType};
use serial_test::serial;
use simplex::simplicityhl::elements::{OutPoint, hashes::Hash};

#[tokio::test]
#[serial]
async fn first_full_repayment_creates_finalized_vaults() -> anyhow::Result<()> {
    let pool = test_pool().await?;
    let factory_id = seed_minimal_factory(&pool).await?;
    let (offer_id, active_outpoint, offer) =
        seed_trackable_active_offer(&pool, factory_id, 1, 100).await?;

    let tx = build_full_repayment_tx(active_outpoint, &offer)?;
    let mut registry = load_registry(&pool).await?;
    process_tx_through_registry(&pool, &mut registry, &tx, TRACKABLE_REPAYMENT_HEIGHT).await?;

    assert_eq!(
        fetch_offer_status(&pool, offer_id).await?,
        OfferStatus::Repaid
    );

    let params = offer_lending_params(&offer)?;
    let total = params.offer_parameters.get_total_amount_to_repay();
    let protocol_fee = params.offer_parameters.get_total_protocol_fee();
    let lender_amount = total - protocol_fee;

    let vaults = fetch_active_vault_rows(&pool, offer_id).await?;
    assert_eq!(vaults.len(), 2);

    let lender = vaults
        .iter()
        .find(|vault| vault.vault_type == VaultType::Lender)
        .expect("lender vault");
    let protocol = vaults
        .iter()
        .find(|vault| vault.vault_type == VaultType::ProtocolFee)
        .expect("protocol fee vault");

    assert!(lender.is_finalized);
    assert!(protocol.is_finalized);
    assert_eq!(lender.amount, lender_amount as i64);
    assert_eq!(protocol.amount, protocol_fee as i64);
    assert_eq!(lender.vout, 1);
    assert_eq!(protocol.vout, 2);
    assert_eq!(lender.txid, tx.txid().to_byte_array().to_vec());

    assert_eq!(
        common::vault_tracking::count_unspent_utxos_of_type(&pool, offer_id, UtxoType::ActiveOffer)
            .await?,
        0
    );

    Ok(())
}

#[tokio::test]
#[serial]
async fn second_partial_repayment_supplies_vaults() -> anyhow::Result<()> {
    let pool = test_pool().await?;
    let factory_id = seed_minimal_factory(&pool).await?;
    let (offer_id, active_outpoint, mut offer) =
        seed_trackable_active_offer(&pool, factory_id, 2, 100).await?;

    let (first_tx, debt_after_first) =
        build_first_partial_repayment_tx(active_outpoint, &offer, FIRST_PARTIAL_AMOUNT)?;
    let first_txid = first_tx.txid();

    let mut registry = load_registry(&pool).await?;
    process_tx_through_registry(&pool, &mut registry, &first_tx, TRACKABLE_REPAYMENT_HEIGHT)
        .await?;

    let vaults_after_first = fetch_active_vault_rows(&pool, offer_id).await?;
    assert_eq!(vaults_after_first.len(), 2);
    assert!(vaults_after_first.iter().all(|vault| !vault.is_finalized));

    offer.current_debt = debt_after_first as i64;
    let params = offer_lending_params(&offer)?;
    let collateral_unlocked = params
        .offer_parameters
        .get_collateral_for_principal(FIRST_PARTIAL_AMOUNT);
    offer.collateral_remaining -= collateral_unlocked as i64;

    let continuing_outpoint = OutPoint {
        txid: first_txid,
        vout: 1,
    };
    let lender_vault_outpoint = OutPoint {
        txid: first_txid,
        vout: 2,
    };
    let protocol_vault_outpoint = OutPoint {
        txid: first_txid,
        vout: 3,
    };

    let second_tx = build_second_partial_repayment_tx(
        continuing_outpoint,
        lender_vault_outpoint,
        protocol_vault_outpoint,
        &offer,
        debt_after_first,
        SECOND_PARTIAL_AMOUNT,
    )?;
    let second_txid = second_tx.txid();

    process_tx_through_registry(
        &pool,
        &mut registry,
        &second_tx,
        TRACKABLE_REPAYMENT_HEIGHT + 1,
    )
    .await?;

    assert_eq!(
        fetch_offer_status(&pool, offer_id).await?,
        OfferStatus::Active
    );

    let vaults = fetch_active_vault_rows(&pool, offer_id).await?;
    assert_eq!(vaults.len(), 2);
    assert!(vaults.iter().all(|vault| !vault.is_finalized));
    assert!(
        vaults
            .iter()
            .all(|vault| vault.txid == second_txid.to_byte_array().to_vec())
    );
    assert!(
        vaults
            .iter()
            .all(|vault| vault.created_at_height == (TRACKABLE_REPAYMENT_HEIGHT + 1) as i64)
    );

    let spent_first_vaults = sqlx::query_scalar!(
        r#"
        SELECT COUNT(*)::BIGINT
        FROM offer_vaults
        WHERE offer_id = $1
          AND spent_txid IS NOT NULL
        "#,
        offer_id
    )
    .fetch_one(&pool)
    .await?
    .unwrap_or(0);
    assert_eq!(spent_first_vaults, 2);

    Ok(())
}

#[tokio::test]
#[serial]
async fn lender_vault_withdraw_all_sets_claimed() -> anyhow::Result<()> {
    let pool = test_pool().await?;
    let factory_id = seed_minimal_factory(&pool).await?;
    let (offer_id, active_outpoint, offer) =
        seed_trackable_active_offer(&pool, factory_id, 3, 100).await?;

    let repay_tx = build_full_repayment_tx(active_outpoint, &offer)?;
    let repay_txid = repay_tx.txid();

    let mut registry = load_registry(&pool).await?;
    process_tx_through_registry(&pool, &mut registry, &repay_tx, TRACKABLE_REPAYMENT_HEIGHT)
        .await?;

    assert_eq!(
        fetch_offer_status(&pool, offer_id).await?,
        OfferStatus::Repaid
    );

    let params = offer_lending_params(&offer)?;
    let total = params.offer_parameters.get_total_amount_to_repay();
    let protocol_fee = params.offer_parameters.get_total_protocol_fee();
    let lender_amount = total - protocol_fee;

    let lender_vault_outpoint = OutPoint {
        txid: repay_txid,
        vout: 1,
    };
    let claim_tx =
        build_lender_vault_withdraw_all_tx(lender_vault_outpoint, &offer, lender_amount)?;

    process_tx_through_registry(
        &pool,
        &mut registry,
        &claim_tx,
        TRACKABLE_REPAYMENT_HEIGHT + 1,
    )
    .await?;

    assert_eq!(
        fetch_offer_status(&pool, offer_id).await?,
        OfferStatus::Claimed
    );

    let active_vaults = fetch_active_vault_rows(&pool, offer_id).await?;
    assert_eq!(active_vaults.len(), 1);
    assert_eq!(active_vaults[0].vault_type, VaultType::ProtocolFee);

    Ok(())
}
