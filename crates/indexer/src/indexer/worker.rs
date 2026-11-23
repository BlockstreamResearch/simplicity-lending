use std::time::Duration;

use simplex::provider::SimplicityNetwork;
use sqlx::PgPool;
use tokio::time::{Interval, interval};

use crate::configuration::IndexerSettings;
use crate::indexer::trackers::TrackerRegistry;
use crate::indexer::{
    AssetRegistration, BlockProcessor, ChainBlock, ChainSource, get_last_indexed_height,
};

pub struct Worker<C: ChainSource> {
    chain: C,
    last_indexed_height: u64,
    interval: Interval,
    block_processor: BlockProcessor,
}

impl<C: ChainSource> Worker<C> {
    pub async fn new(
        settings: IndexerSettings,
        db_pool: PgPool,
        chain: C,
        network: SimplicityNetwork,
    ) -> anyhow::Result<Self> {
        let last_indexed_height = get_last_indexed_height(&db_pool, settings.last_indexed_height)
            .await
            .expect("Failed to get last indexed height");

        let tracker_registry = TrackerRegistry::load(
            &db_pool,
            settings.protocol_fee_keeper_asset_id,
            network,
            AssetRegistration::from_settings(&settings.asset_registry),
        )
        .await?;

        let interval = interval(Duration::from_millis(settings.interval));

        let block_processor = BlockProcessor::new(db_pool, tracker_registry);

        Ok(Self {
            chain,
            last_indexed_height,
            interval,
            block_processor,
        })
    }

    pub async fn run(&mut self) {
        loop {
            self.interval.tick().await;

            let latest_height = match self.chain.tip_height().await {
                Ok(height) => height,
                Err(error) => {
                    tracing::error!("Failed to get latest block height: {error}");
                    continue;
                }
            };

            while self.last_indexed_height < latest_height {
                let next_height = self.last_indexed_height + 1;

                match self.index_block(next_height).await {
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

    async fn index_block(&mut self, height: u64) -> anyhow::Result<()> {
        let hash = self.chain.block_hash_at(height).await?;
        let txs = self.chain.block_txs(&hash).await?;

        self.block_processor
            .process_block(ChainBlock { height, hash, txs })
            .await
    }
}
