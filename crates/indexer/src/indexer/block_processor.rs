use sqlx::PgPool;

use uuid::Uuid;

use crate::{
    events::{IndexerEvent, notify_indexer_event},
    indexer::{ChainBlock, RolledBackBlock, db, rollback_block, trackers::TrackerRegistry},
};

pub struct BlockProcessor {
    db_pool: PgPool,
    tracker_registry: TrackerRegistry,
}

impl BlockProcessor {
    pub fn new(db_pool: PgPool, tracker_registry: TrackerRegistry) -> Self {
        Self {
            db_pool,
            tracker_registry,
        }
    }

    pub fn tracker_registry(&self) -> &TrackerRegistry {
        &self.tracker_registry
    }

    /// Rolls back the last indexed block `height` in one SQL transaction. The tracker
    /// caches are stale afterwards until [`Self::reload_caches`] succeeds.
    pub async fn rollback_block(&mut self, height: u64) -> anyhow::Result<RolledBackBlock> {
        let mut sql_tx = self.db_pool.begin().await?;
        let rolled_back = rollback_block(&mut sql_tx, height).await?;
        sql_tx.commit().await?;

        Ok(rolled_back)
    }

    pub async fn reload_caches(&mut self) -> anyhow::Result<()> {
        self.tracker_registry.reload_caches(&self.db_pool).await
    }

    pub async fn record_starting_block(&self, height: u64, hash: &str) -> anyhow::Result<()> {
        Ok(db::record_starting_block(&self.db_pool, height, hash).await?)
    }

    pub async fn drop_starting_block(&self, height: u64) -> anyhow::Result<bool> {
        Ok(db::drop_starting_block(&self.db_pool, height).await?)
    }

    #[tracing::instrument(
        name = "Processing block",
        skip(self, block),
        fields(block_run_id = %Uuid::new_v4(), height = %block.height)
    )]
    pub async fn process_block(&mut self, block: ChainBlock) -> anyhow::Result<()> {
        let ChainBlock {
            height: block_height,
            hash: block_hash,
            txs,
        } = block;
        let tx_count = txs.len();

        let mut sql_tx = self.db_pool.begin().await?;
        self.tracker_registry.begin_block();

        let process_result = async {
            for tx in txs {
                self.tracker_registry
                    .process_tx(&mut sql_tx, &tx, block_height)
                    .await?;
            }

            db::record_indexed_block(&mut sql_tx, block_height, &block_hash).await?;
            db::upsert_sync_state(&mut sql_tx, block_height, block_hash).await?;

            notify_indexer_event(
                &mut sql_tx,
                &IndexerEvent::BlockIndexed {
                    height: block_height,
                },
            )
            .await?;

            sql_tx.commit().await?;

            Ok(())
        }
        .await;

        match process_result {
            Ok(()) => {
                self.tracker_registry.commit_block();
                tracing::info!(
                    "Successfully indexed block #{} ({} txs)",
                    block_height,
                    tx_count
                );
                Ok(())
            }
            Err(error) => {
                self.tracker_registry.abort_block();
                Err(error)
            }
        }
    }
}
