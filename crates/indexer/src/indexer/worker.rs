use std::time::Duration;

use simplex::provider::SimplicityNetwork;
use sqlx::PgPool;
use tokio::time::{Interval, interval};

use crate::configuration::IndexerSettings;
use crate::indexer::trackers::TrackerRegistry;
use crate::indexer::{
    AssetRegistration, BlockProcessor, ChainBlock, ChainSource, get_last_indexed_block,
    get_last_indexed_height,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StepOutcome {
    /// The block at this height was indexed.
    Indexed(u64),
    /// The block at this height left the chain and was rolled back. For the starting block
    /// of an empty DB, the new block at this height is recorded on the next step instead.
    RolledBack(u64),
    /// Nothing to index: the last indexed block is the chain tip, or above the tip reported
    /// by a lagging Esplora backend.
    UpToDate,
}

pub struct Worker<C: ChainSource> {
    chain: C,
    last_indexed_height: u64,
    /// `None` on an empty DB until the starting block is recorded.
    last_indexed_hash: Option<String>,
    /// Set by a rollback; the tracker caches are reloaded before the next step.
    caches_stale: bool,
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
        let (last_indexed_height, last_indexed_hash) =
            match get_last_indexed_block(&db_pool).await? {
                Some(block) => (block.height as u64, Some(block.hash)),
                None => (
                    get_last_indexed_height(&db_pool, settings.last_indexed_height).await?,
                    None,
                ),
            };

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
            last_indexed_hash,
            caches_stale: false,
            interval,
            block_processor,
        })
    }

    pub fn last_indexed_height(&self) -> u64 {
        self.last_indexed_height
    }

    pub async fn run(&mut self) {
        loop {
            self.interval.tick().await;

            let tip_height = match self.chain.tip_height().await {
                Ok(height) => height,
                Err(error) => {
                    tracing::error!("Failed to get latest block height: {error}");
                    continue;
                }
            };

            loop {
                match self.step_towards(tip_height).await {
                    Ok(StepOutcome::Indexed(_) | StepOutcome::RolledBack(_)) => {}
                    Ok(StepOutcome::UpToDate) => break,
                    Err(error) => {
                        tracing::error!(
                            last_indexed_height = self.last_indexed_height,
                            "Indexer step failed: {error:#}"
                        );
                        break;
                    }
                }
            }
        }
    }

    /// Makes one step towards the current chain tip: indexes the next block, or rolls back
    /// the last indexed block when it is no longer in the chain.
    pub async fn step(&mut self) -> anyhow::Result<StepOutcome> {
        let tip_height = self.chain.tip_height().await?;

        self.step_towards(tip_height).await
    }

    async fn step_towards(&mut self, tip_height: u64) -> anyhow::Result<StepOutcome> {
        if self.caches_stale {
            self.block_processor.reload_caches().await?;
            self.caches_stale = false;
        }

        if tip_height < self.last_indexed_height {
            tracing::warn!(
                tip_height,
                last_indexed_height = self.last_indexed_height,
                "Chain tip is below the last indexed block, waiting"
            );
            return Ok(StepOutcome::UpToDate);
        }

        let last_hash = match &self.last_indexed_hash {
            Some(hash) => hash.clone(),
            None => self.anchor_starting_block().await?,
        };

        if tip_height == self.last_indexed_height {
            // A block replaced at the same height is only visible through its hash.
            if self.chain.block_hash_at(self.last_indexed_height).await? != last_hash {
                return self.rollback_last_block().await;
            }

            return Ok(StepOutcome::UpToDate);
        }

        let height = self.last_indexed_height + 1;
        let hash = self.chain.block_hash_at(height).await?;

        // Comparing hashes at the last height alone races with a reorg between the check and
        // this fetch; the parent link of the fetched block does not.
        if self.chain.block_parent_hash(&hash).await? != last_hash {
            return self.rollback_last_block().await;
        }

        let txs = self.chain.block_txs(&hash).await?;
        self.block_processor
            .process_block(ChainBlock {
                height,
                hash: hash.clone(),
                txs,
            })
            .await?;

        self.last_indexed_height = height;
        self.last_indexed_hash = Some(hash);

        Ok(StepOutcome::Indexed(height))
    }

    /// On an empty DB, records the configured starting block as the last indexed one.
    async fn anchor_starting_block(&mut self) -> anyhow::Result<String> {
        let height = self.last_indexed_height;
        let hash = self.chain.block_hash_at(height).await?;

        self.block_processor
            .record_starting_block(height, &hash)
            .await?;
        self.last_indexed_hash = Some(hash.clone());

        Ok(hash)
    }

    async fn rollback_last_block(&mut self) -> anyhow::Result<StepOutcome> {
        let height = self.last_indexed_height;

        // Nothing was indexed on top of the starting block, so it is simply recorded again.
        if self.block_processor.drop_starting_block(height).await? {
            tracing::warn!(
                height,
                "Starting block left the chain, recording the new one"
            );
            self.last_indexed_hash = None;
            return Ok(StepOutcome::RolledBack(height));
        }

        tracing::warn!(height, "Indexed block left the chain, rolling it back");

        let parent_hash = self.block_processor.rollback_block(height).await?;

        self.last_indexed_height = height - 1;
        self.last_indexed_hash = Some(parent_hash);
        self.caches_stale = true;

        Ok(StepOutcome::RolledBack(height))
    }
}
