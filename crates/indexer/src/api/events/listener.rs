use std::time::Duration;

use sqlx::PgPool;
use sqlx::postgres::PgListener;

use crate::api::events::EventBus;
use crate::events::{INDEXER_EVENTS_CHANNEL, IndexerEvent};

const RECONNECT_DELAY: Duration = Duration::from_secs(2);

pub fn spawn_indexer_events_listener(db: PgPool, events: EventBus) {
    tokio::spawn(async move {
        loop {
            if let Err(error) = listen_loop(&db, &events).await {
                tracing::error!(
                    ?error,
                    "Indexer events LISTEN loop failed; reconnecting in {:?}",
                    RECONNECT_DELAY
                );
                tokio::time::sleep(RECONNECT_DELAY).await;
            }
        }
    });
}

async fn listen_loop(db: &PgPool, events: &EventBus) -> Result<(), sqlx::Error> {
    let mut listener = PgListener::connect_with(db).await?;

    listener.listen(INDEXER_EVENTS_CHANNEL).await?;
    tracing::info!(
        channel = INDEXER_EVENTS_CHANNEL,
        "Listening for indexer event notifications"
    );

    loop {
        let notification = listener.recv().await?;
        match serde_json::from_str::<IndexerEvent>(notification.payload()) {
            Ok(event) => {
                events.publish(event);
            }
            Err(error) => {
                tracing::warn!(
                    payload = notification.payload(),
                    ?error,
                    "Ignoring invalid indexer event notification payload"
                );
            }
        }
    }
}
