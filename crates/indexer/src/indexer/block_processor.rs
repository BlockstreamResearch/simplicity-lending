use sqlx::PgPool;

use simplex::simplicityhl::elements::Transaction;

use uuid::Uuid;

use crate::{
    esplora_client::EsploraClient,
    indexer::{db, trackers::TrackerRegistry},
};

pub struct BlockProcessor {
    db_pool: PgPool,
    client: EsploraClient,
    tracker_registry: TrackerRegistry,
}

impl BlockProcessor {
    pub fn new(db_pool: PgPool, client: EsploraClient, tracker_registry: TrackerRegistry) -> Self {
        Self {
            db_pool,
            client,
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
        let block_hash = self.client.get_block_hash_at_height(block_height).await?;
        let txids = self.client.get_block_txids(&block_hash).await?;
        let tx_count = txids.len();

        let mut txs: Vec<Transaction> = Vec::with_capacity(txids.len());

        for txid in txids {
            txs.push(self.client.get_tx_by_id(txid).await?);
        }

        let mut sql_tx = self.db_pool.begin().await?;
        self.tracker_registry.begin_block();

        let process_result = async {
            for tx in txs {
                self.tracker_registry
                    .process_tx(&mut sql_tx, &tx, block_height)
                    .await?;
            }

            db::upsert_sync_state(&mut sql_tx, block_height, block_hash).await?;
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
