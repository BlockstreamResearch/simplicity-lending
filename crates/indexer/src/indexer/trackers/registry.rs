use simplex::simplicityhl::elements::{AssetId, Transaction, hex::ToHex};

use crate::{
    db::DbTx,
    indexer::{WatchCache, handlers, is_offer_creation_tx},
    models::{ActiveUtxo, UtxoData},
};

pub struct TrackerRegistry {
    cache: WatchCache<ActiveUtxo>,
    protocol_fee_keeper_asset_id: AssetId,
}

impl TrackerRegistry {
    pub fn new(cache: WatchCache<ActiveUtxo>, protocol_fee_keeper_asset_id: AssetId) -> Self {
        Self {
            cache,
            protocol_fee_keeper_asset_id,
        }
    }

    pub fn begin_block(&mut self) {
        self.cache.begin_block();
    }

    pub fn commit_block(&mut self) {
        self.cache.commit_block();
    }

    pub fn abort_block(&mut self) {
        self.cache.abort_block();
    }

    pub fn cache(&self) -> &WatchCache<ActiveUtxo> {
        &self.cache
    }

    #[tracing::instrument(
        name = "Processing utxo tracking",
        skip(self, sql_tx, tx, block_height),
        fields(txid = %tx.txid().to_hex())
    )]
    pub async fn process_tx(
        &mut self,
        sql_tx: &mut DbTx<'_>,
        tx: &Transaction,
        block_height: u64,
    ) -> anyhow::Result<()> {
        let mut is_offer_tx = false;

        for input in &tx.input {
            if let Some(utxo_info) = self.cache.get(&input.previous_output).copied() {
                match utxo_info.data {
                    UtxoData::Offer(utxo_type) => {
                        handlers::handle_offer_transition(
                            sql_tx,
                            tx,
                            &mut self.cache,
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
                            &mut self.cache,
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

        if !is_offer_tx
            && let Some(args) = is_offer_creation_tx(tx, self.protocol_fee_keeper_asset_id)
        {
            handlers::pending_offer::handle_pending_offer_creation(
                sql_tx,
                &mut self.cache,
                args,
                tx,
                block_height,
            )
            .await?;
        }

        Ok(())
    }
}
