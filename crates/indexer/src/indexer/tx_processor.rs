use simplex::simplicityhl::elements::{AssetId, Transaction, hex::ToHex};

use crate::{
    db::DbTx,
    indexer::{cache::UtxoCache, handlers, is_offer_creation_tx},
    models::UtxoData,
};

pub struct TxProcessor {
    protocol_fee_keeper_asset_id: AssetId,
}

impl TxProcessor {
    pub fn new(protocol_fee_keeper_asset_id: AssetId) -> Self {
        Self {
            protocol_fee_keeper_asset_id,
        }
    }

    #[tracing::instrument(
        name = "Processing transaction",
        skip(self, sql_tx, tx, block_height, cache),
        fields(txid = %tx.txid().to_hex())
    )]
    pub async fn process_tx(
        &self,
        sql_tx: &mut DbTx<'_>,
        tx: &Transaction,
        cache: &mut UtxoCache,
        block_height: u64,
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

        if !is_offer_tx
            && let Some(args) = is_offer_creation_tx(tx, self.protocol_fee_keeper_asset_id)
        {
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
}
