use sqlx::PgPool;

use simplex::simplicityhl::elements::{AssetId, Transaction, hex::ToHex};

use uuid::Uuid;

use crate::{
    db::DbTx,
    esplora_client::EsploraClient,
    indexer::{cache::UtxoCache, db, handlers, is_offer_creation_tx},
    models::UtxoData,
};

pub struct BlockProcessor {
    db_pool: PgPool,
    client: EsploraClient,
    protocol_fee_keeper_asset_id: AssetId,
}

impl BlockProcessor {
    pub fn new(
        db_pool: PgPool,
        client: EsploraClient,
        protocol_fee_keeper_asset_id: AssetId,
    ) -> Self {
        Self {
            db_pool,
            client,
            protocol_fee_keeper_asset_id,
        }
    }

    #[tracing::instrument(
        name = "Processing block",
        skip(self, cache),
        fields(block_run_id = %Uuid::new_v4(), height = %block_height)
    )]
    pub async fn process_block(
        &self,
        cache: &mut UtxoCache,
        block_height: u64,
    ) -> anyhow::Result<()> {
        let block_hash = self.client.get_block_hash_at_height(block_height).await?;
        let txids = self.client.get_block_txids(&block_hash).await?;
        let tx_count = txids.len();

        let mut txs: Vec<Transaction> = Vec::with_capacity(txids.len());

        for txid in txids {
            txs.push(self.client.get_tx_by_id(txid).await?);
        }

        let mut sql_tx = self.db_pool.begin().await?;
        cache.begin_block();

        let process_result = async {
            for tx in txs {
                process_tx(
                    &mut sql_tx,
                    &tx,
                    cache,
                    block_height,
                    self.protocol_fee_keeper_asset_id,
                )
                .await?;
            }

            db::upsert_sync_state(&mut sql_tx, block_height, block_hash).await?;
            sql_tx.commit().await?;

            Ok(())
        }
        .await;

        match process_result {
            Ok(()) => {
                cache.commit_block();
                tracing::info!(
                    "Successfully indexed block #{} ({} txs)",
                    block_height,
                    tx_count
                );
                Ok(())
            }
            Err(error) => {
                cache.abort_block();
                Err(error)
            }
        }
    }
}

#[tracing::instrument(
    name = "Processing transaction",
    skip(sql_tx, tx, block_height, cache, protocol_fee_keeper_asset_id),
    fields(txid = %tx.txid().to_hex())
)]
pub async fn process_tx(
    sql_tx: &mut DbTx<'_>,
    tx: &Transaction,
    cache: &mut UtxoCache,
    block_height: u64,
    protocol_fee_keeper_asset_id: AssetId,
) -> anyhow::Result<()> {
    let mut is_offer_tx = false;

    for input in &tx.input {
        if let Some(utxo_info) = cache.get(&input.previous_output) {
            match utxo_info.data {
                UtxoData::Offer(utxo_type) => {
                    handlers::handle_offer_transition(
                        sql_tx,
                        tx,
                        cache,
                        &input.previous_output,
                        utxo_info.offer_id,
                        utxo_type,
                        block_height,
                    )
                    .await?;
                    is_offer_tx = true;
                }
                UtxoData::Participant(participant_type) => {
                    handlers::handle_participant_movement(
                        sql_tx,
                        tx,
                        cache,
                        &input.previous_output,
                        utxo_info.offer_id,
                        participant_type,
                        block_height,
                    )
                    .await?;
                }
            }
        }
    }

    if !is_offer_tx && let Some(args) = is_offer_creation_tx(tx, protocol_fee_keeper_asset_id) {
        handlers::pending_offer::handle_pending_offer_creation(
            sql_tx,
            cache,
            args,
            tx,
            block_height,
        )
        .await?;
    }

    Ok(())
}
