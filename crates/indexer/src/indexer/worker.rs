use std::time::Duration;

use sqlx::PgPool;
use tokio::time::interval;

use crate::configuration::IndexerSettings;
use crate::esplora_client::EsploraClient;
use crate::indexer::{get_starting_height, load_active_utxos, process_block};

pub async fn run_indexer(settings: IndexerSettings, db_pool: PgPool, client: EsploraClient) {
    let mut interval = interval(Duration::from_millis(settings.interval));

    let mut current_height = get_starting_height(&db_pool, settings.start_height).await;

    let mut active_utxos = load_active_utxos(&db_pool)
        .await
        .expect("Failed to load active utxos");

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

            match process_block(&db_pool, &client, &mut active_utxos, next_height).await {
                Ok(_) => {
                    current_height = next_height;
                }
                Err(error) => {
                    tracing::error!("Failed to process block #{next_height}: {error}");
                    break;
                }
            }
        }
    }
}
