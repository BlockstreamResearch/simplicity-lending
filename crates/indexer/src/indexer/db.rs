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

    prune_reorg_history(sql_tx, height as i64 - REORG_HISTORY_DEPTH as i64).await
}

async fn prune_reorg_history(sql_tx: &mut DbTx<'_>, up_to_height: i64) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"
        WITH
            blocks AS (DELETE FROM indexed_blocks WHERE height <= $1),
            offers AS (DELETE FROM offer_state_snapshots WHERE height <= $1)
        DELETE FROM factory_state_snapshots WHERE height <= $1
        "#,
        up_to_height
    )
    .execute(&mut **sql_tx)
    .await
    .map_err(|e| {
        tracing::error!("Failed to prune reorg history: {e:?}");
        e
    })?;

    Ok(())
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
