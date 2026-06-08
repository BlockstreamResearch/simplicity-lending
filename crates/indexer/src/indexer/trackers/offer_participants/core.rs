use simplex::simplicityhl::elements::{OutPoint, Transaction, hashes::Hash};
use sqlx::PgPool;
use uuid::Uuid;

use crate::{
    db::DbTx,
    indexer::cache::WatchCache,
    indexer::trackers::offer_participants::{
        get_offer_participant_asset_id, insert_participant_utxo, load_participants_utxo_cache,
        spend_participant_utxo,
    },
    models::{OfferParticipantModel, ParticipantType},
};

#[derive(Debug, Clone, Copy)]
pub struct ParticipantWatchEntry {
    pub offer_id: Uuid,
    pub participant_type: ParticipantType,
}

pub struct OfferParticipantsTracker {
    cache: WatchCache<ParticipantWatchEntry>,
}

impl OfferParticipantsTracker {
    pub async fn load(db_pool: &PgPool) -> anyhow::Result<Self> {
        Ok(Self {
            cache: load_participants_utxo_cache(db_pool).await?,
        })
    }

    pub async fn process_tx_spends(
        &mut self,
        sql_tx: &mut DbTx<'_>,
        tx: &Transaction,
        block_height: u64,
    ) -> anyhow::Result<()> {
        for input in &tx.input {
            if let Some(entry) = self.cache.get(&input.previous_output) {
                self.on_spend(
                    sql_tx,
                    tx,
                    &input.previous_output,
                    entry.offer_id,
                    entry.participant_type,
                    block_height,
                )
                .await?;
            }
        }

        Ok(())
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

    pub fn watch_insert(&mut self, outpoint: OutPoint, entry: ParticipantWatchEntry) {
        self.cache.insert(outpoint, entry);
    }

    async fn on_spend(
        &mut self,
        sql_tx: &mut DbTx<'_>,
        tx: &Transaction,
        old_outpoint: &OutPoint,
        offer_id: Uuid,
        participant_type: ParticipantType,
        block_height: u64,
    ) -> anyhow::Result<()> {
        let txid = tx.txid();

        let target_asset_id =
            get_offer_participant_asset_id(sql_tx, offer_id, participant_type).await?;

        spend_participant_utxo(sql_tx, old_outpoint, block_height, txid).await?;
        self.cache.remove(old_outpoint);

        let found_output = tx.output.iter().enumerate().find_map(|(vout, output)| {
            if let Some(asset) = output.asset.explicit()
                && asset.into_inner().0.to_vec() == target_asset_id
            {
                return Some((vout as u32, &output.script_pubkey));
            }
            None
        });

        if let Some((vout, script_pubkey)) = found_output {
            if script_pubkey.is_op_return() {
                tracing::info!(
                    %offer_id,
                    ?participant_type,
                    "NFT sent to OP_RETURN. Marking as burned and NOT inserting new record."
                );

                return Ok(());
            }

            let new_outpoint = OutPoint { txid, vout };

            let new_participant = OfferParticipantModel {
                offer_id,
                participant_type,
                script_pubkey: script_pubkey.to_bytes(),
                txid: txid.to_byte_array().to_vec(),
                vout: vout as i32,
                created_at_height: block_height as i64,
                spent_txid: None,
                spent_at_height: None,
            };

            insert_participant_utxo(sql_tx, &new_participant).await?;

            self.cache.insert(
                new_outpoint,
                ParticipantWatchEntry {
                    offer_id,
                    participant_type,
                },
            );

            tracing::info!(%offer_id, ?participant_type, vout, "NFT moved to new location");
        } else {
            tracing::info!(%offer_id, ?participant_type, "NFT was not found in outputs (burned)");
        }

        Ok(())
    }
}
