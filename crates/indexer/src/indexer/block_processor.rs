use std::sync::Arc;

use sqlx::PgPool;

use simplex::provider::{EsploraProvider, ProviderTrait};

use uuid::Uuid;

use crate::{
    events::{IndexerEvent, notify_indexer_event},
    indexer::{db, provider::call_provider, trackers::TrackerRegistry},
};

pub struct BlockProcessor {
    db_pool: PgPool,
    provider: Arc<EsploraProvider>,
    tracker_registry: TrackerRegistry,
}

impl BlockProcessor {
    pub fn new(
        db_pool: PgPool,
        provider: Arc<EsploraProvider>,
        tracker_registry: TrackerRegistry,
    ) -> Self {
        Self {
            db_pool,
            provider,
            tracker_registry,
        }
    }

    pub fn tracker_registry(&self) -> &TrackerRegistry {
        &self.tracker_registry
    }

    #[tracing::instrument(
        name = "Processing block",
        skip(self),
        fields(block_run_id = %Uuid::new_v4(), height = %block_height)
    )]
    pub async fn process_block(&mut self, block_height: u64) -> anyhow::Result<()> {
        let height = u32::try_from(block_height)?;

        let (block_hash, txs) = call_provider(&self.provider, move |provider| {
            let block_hash = provider.fetch_block_hash_at_height(height)?;
            let txs = provider
                .fetch_block_txids(&block_hash)?
                .iter()
                .map(|txid| provider.fetch_transaction(txid))
                .collect::<Result<Vec<_>, _>>()?;

            Ok((block_hash, txs))
        })
        .await?;
        let tx_count = txs.len();

        let mut sql_tx = self.db_pool.begin().await?;
        self.tracker_registry.begin_block();

        let process_result = async {
            for tx in txs {
                self.tracker_registry
                    .process_tx(&mut sql_tx, &tx, block_height)
                    .await?;
            }

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
