use crate::db::DbTx;

use super::types::{INDEXER_EVENTS_CHANNEL, IndexerEvent};

#[tracing::instrument(name = "Notifying indexer event", skip(sql_tx, event))]
pub async fn notify_indexer_event(
    sql_tx: &mut DbTx<'_>,
    event: &IndexerEvent,
) -> Result<(), sqlx::Error> {
    let payload = serde_json::to_string(event).map_err(|error| {
        tracing::error!(?error, "Failed to serialize indexer event");
        sqlx::Error::Encode(error.into())
    })?;

    sqlx::query("SELECT pg_notify($1, $2)")
        .bind(INDEXER_EVENTS_CHANNEL)
        .bind(payload)
        .execute(&mut **sql_tx)
        .await
        .map_err(|error| {
            tracing::error!(
                ?error,
                event_type = event.sse_event_name(),
                "Failed to pg_notify"
            );
            error
        })?;

    Ok(())
}
