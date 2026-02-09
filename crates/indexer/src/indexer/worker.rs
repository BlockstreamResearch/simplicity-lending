use std::time::Duration;

use sqlx::PgPool;
use tokio::time::interval;

use crate::configuration::IndexerSettings;
use crate::esplora_client::EsploraClient;
use crate::indexer::{get_starting_height, process_block};

pub async fn run_indexer(settings: IndexerSettings, db_pool: PgPool, client: EsploraClient) {
    let mut interval = interval(Duration::from_millis(settings.interval));

    let mut current_height = get_starting_height(&db_pool, settings.start_height).await;

    tracing::info!("Indexer started. Starting height: {}", current_height);

    loop {
        interval.tick().await;

        let latest_height = match client.get_latest_block_height().await {
            Ok(h) => h,
            Err(error) => {
                tracing::error!("Failed to get latest block height: {error}");
                continue;
            }
        };

        while current_height < latest_height {
            let next_height = current_height + 1;

            tracing::info!("Processing block {}", next_height);

            match process_block(&db_pool, &client, next_height).await {
                Ok(_) => {
                    current_height = next_height;
                }
                Err(error) => {
                    tracing::error!("Failed to process block #{next_height}: {error}");
                    break;
                }
            }
        }

        match client.get_latest_block_height().await {
            Ok(height) => tracing::info!("Current height is {height}"),
            Err(error) => tracing::error!("Failed to get height: {error}"),
        }
    }
}
