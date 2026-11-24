use sqlx::PgPool;

use crate::{db::DbTx, models::IndexedBlockModel};

/// Number of most recent blocks kept in `indexed_blocks`, which bounds the rollback depth.
pub const REORG_HISTORY_DEPTH: u64 = 6;

#[tracing::instrument(
    name = "Upserting new sync state into DB",
    skip(sql_tx, height, hash),
    fields(last_indexed_height = %height, last_indexed_hash = %hash),
)]
pub async fn upsert_sync_state(
    sql_tx: &mut DbTx<'_>,
    height: u64,
    hash: String,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"
        INSERT INTO sync_state (id, last_indexed_height, last_indexed_hash)
        VALUES (1, $1, $2)
        ON CONFLICT (id) DO UPDATE SET
            last_indexed_height = EXCLUDED.last_indexed_height,
            last_indexed_hash = EXCLUDED.last_indexed_hash,
            updated_at = NOW()
        "#,
        height as i64,
        hash,
    )
    .execute(&mut **sql_tx)
    .await
    .map_err(|e| {
        tracing::error!("Failed to upsert sync state: {e:?}");
        e
    })?;

    Ok(())
}

/// Records an indexed block and drops the history (blocks and state snapshots) beyond
/// [`REORG_HISTORY_DEPTH`].
#[tracing::instrument(
    name = "Recording indexed block in DB",
    skip(sql_tx, height, hash),
    fields(height = %height, hash = %hash),
)]
pub async fn record_indexed_block(
    sql_tx: &mut DbTx<'_>,
    height: u64,
    hash: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"
        INSERT INTO indexed_blocks (height, hash, revertible)
        VALUES ($1, $2, true)
        "#,
        height as i64,
        hash,
    )
    .execute(&mut **sql_tx)
    .await
    .map_err(|e| {
        tracing::error!("Failed to record indexed block: {e:?}");
        e
    })?;

    delete_block_history(sql_tx, 0, height as i64 - REORG_HISTORY_DEPTH as i64).await
}

/// Deletes the recorded blocks and state snapshots at heights `from..=to`.
pub(crate) async fn delete_block_history(
    sql_tx: &mut DbTx<'_>,
    from: i64,
    to: i64,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"
        WITH
            blocks AS (DELETE FROM indexed_blocks WHERE height BETWEEN $1 AND $2),
            offers AS (DELETE FROM offer_state_snapshots WHERE height BETWEEN $1 AND $2)
        DELETE FROM factory_state_snapshots WHERE height BETWEEN $1 AND $2
        "#,
        from,
        to
    )
    .execute(&mut **sql_tx)
    .await
    .map_err(|e| {
        tracing::error!("Failed to delete block history: {e:?}");
        e
    })?;

    Ok(())
}

/// Records the block an empty DB starts indexing after, so the first indexed block can be
/// checked against it. It was not indexed, so it cannot be rolled back.
#[tracing::instrument(name = "Recording starting block in DB", skip(db, hash), fields(%height, %hash))]
pub async fn record_starting_block(
    db: &PgPool,
    height: u64,
    hash: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"
        INSERT INTO indexed_blocks (height, hash, revertible)
        VALUES ($1, $2, false)
        "#,
        height as i64,
        hash,
    )
    .execute(db)
    .await
    .map_err(|e| {
        tracing::error!("Failed to record starting block: {e:?}");
        e
    })?;

    Ok(())
}

/// Removes the starting block at `height` while no block has been indexed yet, i.e.
/// `sync_state` is still empty. Returns whether it was removed.
#[tracing::instrument(name = "Dropping starting block from DB", skip(db))]
pub async fn drop_starting_block(db: &PgPool, height: u64) -> Result<bool, sqlx::Error> {
    let result = sqlx::query!(
        r#"
        DELETE FROM indexed_blocks
        WHERE height = $1 AND NOT revertible AND NOT EXISTS (SELECT 1 FROM sync_state)
        "#,
        height as i64,
    )
    .execute(db)
    .await
    .map_err(|e| {
        tracing::error!("Failed to drop starting block: {e:?}");
        e
    })?;

    Ok(result.rows_affected() == 1)
}

#[tracing::instrument(name = "Getting last indexed block", skip(db))]
pub async fn get_last_indexed_block(db: &PgPool) -> Result<Option<IndexedBlockModel>, sqlx::Error> {
    sqlx::query_as!(
        IndexedBlockModel,
        r#"
        SELECT height, hash, revertible
        FROM indexed_blocks
        ORDER BY height DESC
        LIMIT 1
        "#
    )
    .fetch_optional(db)
    .await
}

#[tracing::instrument(name = "Getting last indexed block height", skip(db))]
pub async fn get_last_indexed_height(db: &PgPool, config_height: u64) -> Result<u64, sqlx::Error> {
    let row = sqlx::query!("SELECT last_indexed_height FROM sync_state WHERE id = 1")
        .fetch_optional(db)
        .await?;

    match row {
        Some(r) => Ok(r.last_indexed_height as u64),
        None => {
            tracing::info!(
                "No sync state found in DB, starting from config: {}",
                config_height
            );
            Ok(config_height)
        }
    }
}
