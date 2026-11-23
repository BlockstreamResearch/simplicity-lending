mod common;

use common::test_pool;
use lending_indexer::indexer::{
    REORG_HISTORY_DEPTH, drop_starting_block, get_last_indexed_block, record_indexed_block,
    record_starting_block, upsert_sync_state,
};
use lending_indexer::models::IndexedBlockModel;
use serial_test::serial;
use sqlx::PgPool;

async fn record(pool: &PgPool, height: u64) -> anyhow::Result<()> {
    let mut sql_tx = pool.begin().await?;
    record_indexed_block(&mut sql_tx, height, &format!("hash-{height}")).await?;
    sql_tx.commit().await?;

    Ok(())
}

async fn recorded_heights(pool: &PgPool) -> anyhow::Result<Vec<i64>> {
    Ok(
        sqlx::query_scalar("SELECT height FROM indexed_blocks ORDER BY height")
            .fetch_all(pool)
            .await?,
    )
}

#[tokio::test]
#[serial]
async fn last_indexed_block_is_none_without_history() -> anyhow::Result<()> {
    let pool = test_pool().await?;

    assert_eq!(get_last_indexed_block(&pool).await?, None);

    Ok(())
}

#[tokio::test]
#[serial]
async fn recorded_block_is_the_last_revertible_block() -> anyhow::Result<()> {
    let pool = test_pool().await?;

    record(&pool, 100).await?;
    record(&pool, 101).await?;

    assert_eq!(
        get_last_indexed_block(&pool).await?,
        Some(IndexedBlockModel {
            height: 101,
            hash: "hash-101".to_string(),
            revertible: true,
        })
    );

    Ok(())
}

#[tokio::test]
#[serial]
async fn history_keeps_only_the_most_recent_blocks() -> anyhow::Result<()> {
    let pool = test_pool().await?;
    let last = 100 + REORG_HISTORY_DEPTH + 3;

    for height in 100..=last {
        record(&pool, height).await?;
    }

    let expected: Vec<i64> = ((last - REORG_HISTORY_DEPTH + 1)..=last)
        .map(|height| height as i64)
        .collect();
    assert_eq!(recorded_heights(&pool).await?, expected);

    Ok(())
}

#[tokio::test]
#[serial]
async fn starting_block_is_dropped_only_before_the_first_indexed_block() -> anyhow::Result<()> {
    let pool = test_pool().await?;
    record_starting_block(&pool, 100, "hash-100").await?;

    assert!(drop_starting_block(&pool, 100).await?);
    assert_eq!(get_last_indexed_block(&pool).await?, None);

    // A block indexed before undo data existed has `sync_state`, like after the migration.
    record_starting_block(&pool, 100, "hash-100").await?;
    let mut sql_tx = pool.begin().await?;
    upsert_sync_state(&mut sql_tx, 100, "hash-100".to_string()).await?;
    sql_tx.commit().await?;

    assert!(!drop_starting_block(&pool, 100).await?);
    assert_eq!(recorded_heights(&pool).await?, vec![100]);

    Ok(())
}

#[tokio::test]
#[serial]
async fn recording_an_indexed_height_again_fails() -> anyhow::Result<()> {
    let pool = test_pool().await?;
    record(&pool, 100).await?;

    let mut sql_tx = pool.begin().await?;
    let result = record_indexed_block(&mut sql_tx, 100, "other-hash").await;

    assert!(result.is_err());

    Ok(())
}
