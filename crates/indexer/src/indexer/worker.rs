use std::time::Duration;

use sqlx::PgPool;
use tokio::time::{Interval, interval};

use crate::configuration::IndexerSettings;
use crate::esplora_client::EsploraClient;
use crate::indexer::{BlockProcessor, UtxoCache, get_last_indexed_height, load_utxo_cache};

pub struct Worker {
    client: EsploraClient,
    cache: UtxoCache,
    last_indexed_height: u64,
    interval: Interval,
    block_processor: BlockProcessor,
}

impl Worker {
    pub async fn new(settings: IndexerSettings, db_pool: PgPool, client: EsploraClient) -> Self {
        let last_indexed_height = get_last_indexed_height(&db_pool, settings.last_indexed_height)
            .await
            .expect("Failed to get last indexed height");

        let cache = load_utxo_cache(&db_pool)
            .await
            .expect("Failed to load active utxos");

        let interval = interval(Duration::from_millis(settings.interval));

        let block_processor = BlockProcessor::new(
            db_pool,
            client.clone(),
            settings.protocol_fee_keeper_asset_id,
        );

        Self {
            client,
            cache,
            last_indexed_height,
            interval,
            block_processor,
        }
    }

    pub async fn run(&mut self) {
        loop {
            self.interval.tick().await;

            let latest_height = match self.client.get_latest_block_height().await {
                Ok(h) => h,
                Err(error) => {
                    tracing::error!("Failed to get latest block height: {error}");
                    continue;
                }
            };

            while self.last_indexed_height < latest_height {
                let next_height = self.last_indexed_height + 1;

                match self
                    .block_processor
                    .process_block(&mut self.cache, next_height)
                    .await
                {
                    Ok(_) => {
                        self.last_indexed_height = next_height;
                    }
                    Err(error) => {
                        tracing::error!("Failed to process block #{next_height}: {error}");
                        break;
                    }
                }
            }
        }
    }
}
