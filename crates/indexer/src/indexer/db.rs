use sqlx::PgPool;

use crate::db::DbTx;

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
