use uuid::Uuid;

use simplex::{
    provider::SimplicityNetwork,
    simplicityhl::elements::{AssetId, OutPoint, Transaction, hashes::Hash},
};

use lending_contracts::programs::{
    lending::{LendingOffer, LendingOfferParameters},
    program::SimplexProgram,
};

use crate::{
    db::DbTx,
    indexer::trackers::{
        offer_participants::{
            OfferParticipantsTracker, ParticipantWatchEntry, insert_participant_utxo,
        },
        offers::{OffersTracker, OffersWatchEntry, insert_offer_utxo},
        offers_creation::insert_offer,
    },
    models::{OfferModel, OfferParticipantModel, OfferUtxoModel, ParticipantType, UtxoType},
};

pub struct OfferCreationsTracker {
    protocol_fee_keeper_asset_id: AssetId,
    network: SimplicityNetwork,
}

impl OfferCreationsTracker {
    pub fn new(protocol_fee_keeper_asset_id: AssetId, network: SimplicityNetwork) -> Self {
        Self {
            protocol_fee_keeper_asset_id,
            network,
        }
    }

    pub async fn process_creation_tx(
        &self,
        sql_tx: &mut DbTx<'_>,
        tx: &Transaction,
        block_height: u64,
        factory_id: Uuid,
        offers: &mut OffersTracker,
        participants: &mut OfferParticipantsTracker,
    ) -> anyhow::Result<()> {
        if let Some(offer_parameters) = self.is_offer_creation_tx(tx) {
            Self::handle_offer_creation(
                sql_tx,
                offer_parameters,
                factory_id,
                tx,
                block_height,
                offers,
                participants,
            )
            .await?
        }

        Ok(())
    }

    async fn handle_offer_creation(
        sql_tx: &mut DbTx<'_>,
        offer_parameters: LendingOfferParameters,
        factory_id: Uuid,
        tx: &Transaction,
        block_height: u64,
        offers: &mut OffersTracker,
        participants: &mut OfferParticipantsTracker,
    ) -> anyhow::Result<()> {
        let txid = tx.txid();

        let offer_model = OfferModel::new(&offer_parameters, factory_id, block_height, txid);

        if insert_offer(sql_tx, &offer_model).await?.is_none() {
            tracing::debug!(%txid, "Offer already indexed, skipping");
            return Ok(());
        }

        let lending_offer_outpoint = OutPoint { txid, vout: 5 };
        let lending_offer_utxo = OfferUtxoModel {
            offer_id: offer_model.id,
            txid: txid.to_byte_array().to_vec(),
            vout: lending_offer_outpoint.vout as i32,
            utxo_type: UtxoType::PendingOffer,
            created_at_height: block_height as i64,
            spent_at_height: None,
            spent_txid: None,
        };

        insert_offer_utxo(sql_tx, &lending_offer_utxo).await?;
        offers.watch_insert(
            lending_offer_outpoint,
            OffersWatchEntry {
                offer_id: offer_model.id,
                utxo_type: UtxoType::PendingOffer,
            },
        );

        let borrower_nft_outpoint = OutPoint { txid, vout: 2 };
        let borrower_participant_utxo = OfferParticipantModel {
            offer_id: offer_model.id,
            participant_type: ParticipantType::Borrower,
            script_pubkey: tx.output[2].script_pubkey.to_bytes().to_vec(),
            txid: txid.to_byte_array().to_vec(),
            vout: borrower_nft_outpoint.vout as i32,
            created_at_height: block_height as i64,
            spent_txid: None,
            spent_at_height: None,
        };
        insert_participant_utxo(sql_tx, &borrower_participant_utxo).await?;
        participants.watch_insert(
            borrower_nft_outpoint,
            ParticipantWatchEntry {
                offer_id: offer_model.id,
                participant_type: ParticipantType::Borrower,
            },
        );

        let lender_nft_outpoint = OutPoint { txid, vout: 3 };
        let lender_participant_utxo = OfferParticipantModel {
            offer_id: offer_model.id,
            participant_type: ParticipantType::Lender,
            script_pubkey: tx.output[3].script_pubkey.to_bytes().to_vec(),
            txid: txid.to_byte_array().to_vec(),
            vout: lender_nft_outpoint.vout as i32,
            created_at_height: block_height as i64,
            spent_txid: None,
            spent_at_height: None,
        };
        insert_participant_utxo(sql_tx, &lender_participant_utxo).await?;
        participants.watch_insert(
            lender_nft_outpoint,
            ParticipantWatchEntry {
                offer_id: offer_model.id,
                participant_type: ParticipantType::Lender,
            },
        );

        Ok(())
    }

    fn is_offer_creation_tx(&self, tx: &Transaction) -> Option<LendingOfferParameters> {
        let offer =
            LendingOffer::try_from_tx(tx, self.protocol_fee_keeper_asset_id, self.network).ok()?;

        let offer_script_pubkey = offer.get_script_pubkey();

        // TODO: Get UTXO indexes from the PendingLendingOffer program
        if tx.output[5].script_pubkey != offer_script_pubkey {
            return None;
        }

        Some(*offer.get_parameters())
    }
}
