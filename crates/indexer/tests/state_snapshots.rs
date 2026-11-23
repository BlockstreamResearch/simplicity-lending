mod common;

use common::{
    factory_model, offer_model, seed_factory_row, seed_offer_row, test_pool,
    unique_32_bytes_from_uuid,
};
use lending_indexer::indexer::{
    REORG_HISTORY_DEPTH, record_indexed_block, update_factory_status,
    update_offer_debt_and_collateral, update_offer_status,
};
use lending_indexer::models::{FactoryStatus, OfferStatus};
use serial_test::serial;
use sqlx::PgPool;
use uuid::Uuid;

/// `(height, current_status, current_debt, collateral_remaining, updated_at_height)`
type OfferSnapshot = (i64, OfferStatus, i64, i64, i64);

const CREATED_AT_HEIGHT: i64 = 100;

async fn seed_factory(pool: &PgPool) -> anyhow::Result<Uuid> {
    let id = Uuid::new_v4();
    seed_factory_row(
        pool,
        &factory_model(id, CREATED_AT_HEIGHT, unique_32_bytes_from_uuid(id)),
    )
    .await?;

    Ok(id)
}

/// Seeds a pending offer: debt 506, collateral 1000, updated at [`CREATED_AT_HEIGHT`].
async fn seed_pending_offer(pool: &PgPool) -> anyhow::Result<i64> {
    let factory_id = seed_factory(pool).await?;
    seed_offer_row(pool, &mut offer_model(1, factory_id, CREATED_AT_HEIGHT)).await
}

async fn offer_snapshots(pool: &PgPool, offer_id: i64) -> anyhow::Result<Vec<OfferSnapshot>> {
    Ok(sqlx::query_as(
        r#"
        SELECT height, current_status, current_debt, collateral_remaining, updated_at_height
        FROM offer_state_snapshots
        WHERE offer_id = $1
        ORDER BY height
        "#,
    )
    .bind(offer_id)
    .fetch_all(pool)
    .await?)
}

async fn activate_offer(pool: &PgPool, offer_id: i64, height: u64) -> anyhow::Result<()> {
    let mut sql_tx = pool.begin().await?;
    update_offer_status(&mut sql_tx, offer_id, OfferStatus::Active, height).await?;
    sql_tx.commit().await?;

    Ok(())
}

#[tokio::test]
#[serial]
async fn offer_snapshot_keeps_the_state_before_the_block() -> anyhow::Result<()> {
    let pool = test_pool().await?;
    let offer_id = seed_pending_offer(&pool).await?;

    let mut sql_tx = pool.begin().await?;
    update_offer_status(&mut sql_tx, offer_id, OfferStatus::Active, 200).await?;
    update_offer_debt_and_collateral(&mut sql_tx, offer_id, 300, 600, 200).await?;
    update_offer_status(&mut sql_tx, offer_id, OfferStatus::Repaid, 200).await?;
    sql_tx.commit().await?;

    assert_eq!(
        offer_snapshots(&pool, offer_id).await?,
        vec![(200, OfferStatus::Pending, 506, 1_000, CREATED_AT_HEIGHT)]
    );

    Ok(())
}

#[tokio::test]
#[serial]
async fn offer_updates_in_different_blocks_get_separate_snapshots() -> anyhow::Result<()> {
    let pool = test_pool().await?;
    let offer_id = seed_pending_offer(&pool).await?;

    activate_offer(&pool, offer_id, 200).await?;

    let mut sql_tx = pool.begin().await?;
    update_offer_debt_and_collateral(&mut sql_tx, offer_id, 300, 600, 201).await?;
    sql_tx.commit().await?;

    assert_eq!(
        offer_snapshots(&pool, offer_id).await?,
        vec![
            (200, OfferStatus::Pending, 506, 1_000, CREATED_AT_HEIGHT),
            (201, OfferStatus::Active, 506, 1_000, 200),
        ]
    );

    Ok(())
}

#[tokio::test]
#[serial]
async fn factory_snapshot_keeps_the_status_before_removal() -> anyhow::Result<()> {
    let pool = test_pool().await?;
    let factory_id = seed_factory(&pool).await?;

    let mut sql_tx = pool.begin().await?;
    update_factory_status(&mut sql_tx, factory_id, FactoryStatus::Removed, 300).await?;
    sql_tx.commit().await?;

    let snapshot: (FactoryStatus,) = sqlx::query_as(
        "SELECT current_status FROM factory_state_snapshots WHERE factory_id = $1 AND height = 300",
    )
    .bind(factory_id)
    .fetch_one(&pool)
    .await?;

    assert_eq!(snapshot.0, FactoryStatus::Active);

    Ok(())
}

#[tokio::test]
#[serial]
async fn snapshots_are_pruned_with_the_block_history() -> anyhow::Result<()> {
    let pool = test_pool().await?;
    let offer_id = seed_pending_offer(&pool).await?;

    activate_offer(&pool, offer_id, 200).await?;
    let mut sql_tx = pool.begin().await?;
    update_offer_debt_and_collateral(&mut sql_tx, offer_id, 300, 600, 201).await?;
    sql_tx.commit().await?;

    // Recording this block drops the history at or below height 200.
    let mut sql_tx = pool.begin().await?;
    record_indexed_block(&mut sql_tx, 200 + REORG_HISTORY_DEPTH, "hash").await?;
    sql_tx.commit().await?;

    let heights: Vec<i64> = offer_snapshots(&pool, offer_id)
        .await?
        .into_iter()
        .map(|snapshot| snapshot.0)
        .collect();
    assert_eq!(heights, vec![201]);

    Ok(())
}
