use simplex::simplicityhl::elements::{OutPoint, Transaction, Txid, hashes::Hash};
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

#[derive(Debug, Clone)]
pub struct ParticipantCreationUtxo {
    pub txid: Txid,
    pub vout: u32,
    pub script_pubkey: Vec<u8>,
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

    pub async fn seed_creation_participant_utxo(
        &mut self,
        sql_tx: &mut DbTx<'_>,
        offer_id: Uuid,
        participant_type: ParticipantType,
        utxo: ParticipantCreationUtxo,
        block_height: u64,
    ) -> anyhow::Result<()> {
        let participant = Self::new_participant_model(
            offer_id,
            participant_type,
            utxo.txid,
            utxo.vout,
            &utxo.script_pubkey,
            block_height,
        );

        self.insert_participant_utxo_tracked(
            sql_tx,
            &participant,
            "Participant UTXO indexed on offer creation",
        )
        .await
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

            let new_participant = Self::new_participant_model(
                offer_id,
                participant_type,
                txid,
                vout,
                script_pubkey.as_bytes(),
                block_height,
            );

            self.insert_participant_utxo_tracked(
                sql_tx,
                &new_participant,
                "NFT moved to new location",
            )
            .await?;
        } else {
            tracing::info!(%offer_id, ?participant_type, "NFT was not found in outputs (burned)");
        }

        Ok(())
    }

    fn new_participant_model(
        offer_id: Uuid,
        participant_type: ParticipantType,
        txid: Txid,
        vout: u32,
        script_pubkey: &[u8],
        block_height: u64,
    ) -> OfferParticipantModel {
        OfferParticipantModel {
            offer_id,
            participant_type,
            script_pubkey: script_pubkey.to_vec(),
            txid: txid.to_byte_array().to_vec(),
            vout: vout as i32,
            created_at_height: block_height as i64,
            spent_txid: None,
            spent_at_height: None,
        }
    }

    async fn insert_participant_utxo_tracked(
        &mut self,
        sql_tx: &mut DbTx<'_>,
        participant: &OfferParticipantModel,
        log_message: &'static str,
    ) -> anyhow::Result<()> {
        let outpoint = OutPoint {
            txid: Txid::from_slice(&participant.txid)?,
            vout: participant.vout as u32,
        };

        insert_participant_utxo(sql_tx, participant).await?;
        self.cache.insert(
            outpoint,
            ParticipantWatchEntry {
                offer_id: participant.offer_id,
                participant_type: participant.participant_type,
            },
        );

        tracing::info!(
            offer_id = %participant.offer_id,
            participant_type = ?participant.participant_type,
            txid = %outpoint.txid,
            ?outpoint,
            message = log_message
        );

        Ok(())
    }
}
