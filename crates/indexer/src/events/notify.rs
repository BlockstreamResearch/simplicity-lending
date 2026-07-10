use crate::db::DbTx;

use super::types::BLOCK_INDEXED_CHANNEL;

#[tracing::instrument(
    name = "Notifying block indexed",
    skip(sql_tx),
    fields(height = %height)
)]
pub async fn notify_block_indexed(sql_tx: &mut DbTx<'_>, height: u64) -> Result<(), sqlx::Error> {
    sqlx::query("SELECT pg_notify($1, $2)")
        .bind(BLOCK_INDEXED_CHANNEL)
        .bind(height.to_string())
        .execute(&mut **sql_tx)
        .await
        .map_err(|e| {
            tracing::error!(?e, height, "Failed to notify block indexed");
            e
        })?;

    Ok(())
}
