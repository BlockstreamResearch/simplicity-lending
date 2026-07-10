use std::time::Duration;

use sqlx::PgPool;
use sqlx::postgres::PgListener;

use crate::api::events::EventBus;
use crate::events::{BLOCK_INDEXED_CHANNEL, IndexerEvent};

const RECONNECT_DELAY: Duration = Duration::from_secs(2);

pub fn spawn_block_indexed_listener(db: PgPool, events: EventBus) {
    tokio::spawn(async move {
        loop {
            if let Err(error) = listen_loop(&db, &events).await {
                tracing::error!(
                    ?error,
                    "Block-indexed LISTEN loop failed; reconnecting in {:?}",
                    RECONNECT_DELAY
                );
                tokio::time::sleep(RECONNECT_DELAY).await;
            }
        }
    });
}

async fn listen_loop(db: &PgPool, events: &EventBus) -> Result<(), sqlx::Error> {
    let mut listener = PgListener::connect_with(db).await?;

    listener.listen(BLOCK_INDEXED_CHANNEL).await?;
    tracing::info!(
        channel = BLOCK_INDEXED_CHANNEL,
        "Listening for block-indexed notifications"
    );

    loop {
        let notification = listener.recv().await?;
        match notification.payload().parse::<u64>() {
            Ok(height) => {
                events.publish(IndexerEvent::BlockIndexed { height });
            }
            Err(error) => {
                tracing::warn!(
                    payload = notification.payload(),
                    ?error,
                    "Ignoring invalid block-indexed notification payload"
                );
            }
        }
    }
}
