mod common;

use common::db_state::{dump_chain_state, index_block, rollback};
use common::vault_tracking::{
    FIRST_PARTIAL_AMOUNT, SECOND_PARTIAL_AMOUNT, TRACKABLE_REPAYMENT_HEIGHT,
    apply_repayment_to_offer, build_first_partial_repayment_tx, build_second_partial_repayment_tx,
    fetch_offer_status, load_registry, seed_minimal_factory, seed_trackable_active_offer,
};
use common::{
    acceptance_tx, cancellation_tx, normal_output, seed_pending_offer, test_pool, tx_with_input,
};
use lending_indexer::models::OfferStatus;
use serial_test::serial;
use simplex::simplicityhl::elements::OutPoint;

const PARENT: u64 = TRACKABLE_REPAYMENT_HEIGHT;
const BLOCK: u64 = PARENT + 1;
const SEED_HEIGHT: i64 = 100;

#[tokio::test]
#[serial]
async fn utxo_unspent_by_rollback_is_tracked_again_after_reload() -> anyhow::Result<()> {
    let pool = test_pool().await?;
    let factory_id = seed_minimal_factory(&pool).await?;
    let (offer_id, pending_outpoint) =
        seed_pending_offer(&pool, factory_id, 1, SEED_HEIGHT).await?;
    let mut registry = load_registry(&pool).await?;

    index_block(&pool, &mut registry, PARENT, &[]).await?;
    index_block(
        &pool,
        &mut registry,
        BLOCK,
        &[acceptance_tx(pending_outpoint)],
    )
    .await?;
    rollback(&pool, BLOCK).await?;

    // The stale cache dropped the pending UTXO when the acceptance spent it.
    let mut sql_tx = pool.begin().await?;
    registry.begin_block();
    registry
        .process_tx(&mut sql_tx, &cancellation_tx(pending_outpoint), BLOCK)
        .await?;
    let status: OfferStatus = sqlx::query_scalar("SELECT current_status FROM offers WHERE id = $1")
        .bind(offer_id)
        .fetch_one(&mut *sql_tx)
        .await?;
    assert_eq!(status, OfferStatus::Pending);
    registry.abort_block();
    drop(sql_tx);

    registry.reload_caches(&pool).await?;
    index_block(
        &pool,
        &mut registry,
        BLOCK,
        &[cancellation_tx(pending_outpoint)],
    )
    .await?;

    assert_eq!(
        fetch_offer_status(&pool, offer_id).await?,
        OfferStatus::Cancelled
    );

    Ok(())
}

#[tokio::test]
#[serial]
async fn utxo_created_in_rolled_back_block_is_dropped_after_reload() -> anyhow::Result<()> {
    let pool = test_pool().await?;
    let factory_id = seed_minimal_factory(&pool).await?;
    let (_, active_outpoint, offer) =
        seed_trackable_active_offer(&pool, factory_id, 1, SEED_HEIGHT).await?;
    let mut registry = load_registry(&pool).await?;

    let (repayment, _) =
        build_first_partial_repayment_tx(active_outpoint, &offer, FIRST_PARTIAL_AMOUNT)?;
    index_block(&pool, &mut registry, PARENT, &[]).await?;
    index_block(
        &pool,
        &mut registry,
        BLOCK,
        std::slice::from_ref(&repayment),
    )
    .await?;
    rollback(&pool, BLOCK).await?;

    // Spends the continuing offer UTXO that only existed in the rolled back block.
    let spend = tx_with_input(OutPoint::new(repayment.txid(), 1), vec![normal_output()]);

    // The stale cache still tracks it as an active offer and fails to classify the spend.
    let mut sql_tx = pool.begin().await?;
    registry.begin_block();
    assert!(
        registry
            .process_tx(&mut sql_tx, &spend, BLOCK)
            .await
            .is_err()
    );
    registry.abort_block();
    drop(sql_tx);

    registry.reload_caches(&pool).await?;
    index_block(&pool, &mut registry, BLOCK, &[spend]).await?;

    let spent_in_block: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM offer_utxos WHERE spent_at_height = $1")
            .bind(BLOCK as i64)
            .fetch_one(&pool)
            .await?;
    assert_eq!(spent_in_block, 0);

    Ok(())
}

#[tokio::test]
#[serial]
async fn reindexing_after_rollback_and_reload_reproduces_the_block() -> anyhow::Result<()> {
    let pool = test_pool().await?;
    let factory_id = seed_minimal_factory(&pool).await?;
    let (_, active_outpoint, mut offer) =
        seed_trackable_active_offer(&pool, factory_id, 1, SEED_HEIGHT).await?;
    let mut registry = load_registry(&pool).await?;

    let (first, debt_after_first) =
        build_first_partial_repayment_tx(active_outpoint, &offer, FIRST_PARTIAL_AMOUNT)?;
    let first_txid = first.txid();
    index_block(&pool, &mut registry, PARENT, &[first]).await?;

    apply_repayment_to_offer(&mut offer, FIRST_PARTIAL_AMOUNT)?;
    let second = build_second_partial_repayment_tx(
        OutPoint::new(first_txid, 1),
        OutPoint::new(first_txid, 2),
        OutPoint::new(first_txid, 3),
        &offer,
        debt_after_first,
        SECOND_PARTIAL_AMOUNT,
    )?;

    // Spends the active offer UTXO and both vaults, which the rollback makes unspent again.
    index_block(&pool, &mut registry, BLOCK, std::slice::from_ref(&second)).await?;
    let indexed = dump_chain_state(&pool).await?;

    rollback(&pool, BLOCK).await?;
    registry.reload_caches(&pool).await?;
    index_block(&pool, &mut registry, BLOCK, &[second]).await?;

    assert_eq!(dump_chain_state(&pool).await?, indexed);

    Ok(())
}
