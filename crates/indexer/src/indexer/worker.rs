use std::{sync::Arc, time::Duration};

use simplex::provider::{EsploraProvider, ProviderTrait};
use sqlx::PgPool;
use tokio::time::{Interval, interval};

use crate::configuration::IndexerSettings;
use crate::indexer::provider::call_provider;
use crate::indexer::trackers::TrackerRegistry;
use crate::indexer::{AssetRegistration, BlockProcessor, get_last_indexed_height};

pub struct Worker {
    provider: Arc<EsploraProvider>,
    last_indexed_height: u64,
    interval: Interval,
    block_processor: BlockProcessor,
}

impl Worker {
    pub async fn new(
        settings: IndexerSettings,
        db_pool: PgPool,
        provider: EsploraProvider,
    ) -> anyhow::Result<Self> {
        let provider = Arc::new(provider);
        let last_indexed_height = get_last_indexed_height(&db_pool, settings.last_indexed_height)
            .await
            .expect("Failed to get last indexed height");

        let tracker_registry = TrackerRegistry::load(
            &db_pool,
            settings.protocol_fee_keeper_asset_id,
            *provider.get_network(),
            AssetRegistration::from_settings(&settings.asset_registry),
        )
        .await?;

        let interval = interval(Duration::from_millis(settings.interval));

        let block_processor = BlockProcessor::new(db_pool, Arc::clone(&provider), tracker_registry);

        Ok(Self {
            provider,
            last_indexed_height,
            interval,
            block_processor,
        })
    }

    pub async fn run(&mut self) {
        loop {
            self.interval.tick().await;

            let latest_height =
                match call_provider(&self.provider, |provider| provider.fetch_tip_height()).await {
                    Ok(h) => u64::from(h),
                    Err(error) => {
                        tracing::error!("Failed to get latest block height: {error}");
                        continue;
                    }
                };

            while self.last_indexed_height < latest_height {
                let next_height = self.last_indexed_height + 1;

                match self.block_processor.process_block(next_height).await {
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
