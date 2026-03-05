use std::time::Duration;

use sqlx::PgPool;
use tokio::time::interval;

use crate::configuration::IndexerSettings;
use crate::esplora_client::EsploraClient;
use crate::indexer::{get_last_indexed_height, load_utxo_cache, process_block};

pub async fn run_indexer(settings: IndexerSettings, db_pool: PgPool, client: EsploraClient) {
    let mut interval = interval(Duration::from_millis(settings.interval));

    let mut last_indexed_height = get_last_indexed_height(&db_pool, settings.last_indexed_height)
        .await
        .expect("Failed to get last indexed height");

    let mut cache = load_utxo_cache(&db_pool)
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

        while last_indexed_height < latest_height {
            let next_height = last_indexed_height + 1;

            match process_block(&db_pool, &client, &mut cache, next_height).await {
                Ok(_) => {
                    last_indexed_height = next_height;
                }
                Err(error) => {
                    tracing::error!("Failed to process block #{next_height}: {error}");
                    break;
                }
            }
        }
    }
}
