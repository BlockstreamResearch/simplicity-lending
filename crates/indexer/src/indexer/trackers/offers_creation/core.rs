use uuid::Uuid;

use simplex::{
    provider::SimplicityNetwork,
    simplicityhl::elements::{AssetId, Transaction},
};

use lending_contracts::programs::{
    lending::{LendingOffer, LendingOfferParameters},
    program::SimplexProgram,
};

use crate::{
    db::DbTx,
    indexer::{
        OfferCreationOutputs, OfferParticipantsTracker, OffersTracker, ParticipantCreationUtxo,
        scan_offer_creation_outputs, trackers::offers_creation::insert_offer,
    },
    models::{OfferModel, ParticipantType},
};

struct ParsedOfferCreation {
    parameters: LendingOfferParameters,
    outputs: OfferCreationOutputs,
}

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
        if let Some(creation) = self.parse_offer_creation_tx(tx) {
            Self::handle_offer_creation(
                sql_tx,
                creation,
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
        creation: ParsedOfferCreation,
        factory_id: Uuid,
        tx: &Transaction,
        block_height: u64,
        offers: &mut OffersTracker,
        participants: &mut OfferParticipantsTracker,
    ) -> anyhow::Result<()> {
        let txid = tx.txid();

        let offer_model = OfferModel::new(&creation.parameters, factory_id, block_height, txid);

        if insert_offer(sql_tx, &offer_model).await?.is_none() {
            tracing::debug!(%txid, "Offer already indexed, skipping");
            return Ok(());
        }

        offers
            .seed_creation_pending_offer_utxo(
                sql_tx,
                offer_model.id,
                txid,
                creation.outputs.pending_offer_vout,
                block_height,
            )
            .await?;

        participants
            .seed_creation_participant_utxo(
                sql_tx,
                offer_model.id,
                ParticipantType::Borrower,
                ParticipantCreationUtxo {
                    txid,
                    vout: creation.outputs.borrower_nft_vout,
                    script_pubkey: creation.outputs.borrower_nft_script_pubkey,
                },
                block_height,
            )
            .await?;

        participants
            .seed_creation_participant_utxo(
                sql_tx,
                offer_model.id,
                ParticipantType::Lender,
                ParticipantCreationUtxo {
                    txid,
                    vout: creation.outputs.lender_nft_vout,
                    script_pubkey: creation.outputs.lender_nft_script_pubkey,
                },
                block_height,
            )
            .await?;

        Ok(())
    }

    fn parse_offer_creation_tx(&self, tx: &Transaction) -> Option<ParsedOfferCreation> {
        let offer =
            LendingOffer::try_from_tx(tx, self.protocol_fee_keeper_asset_id, self.network).ok()?;

        let parameters = *offer.get_parameters();
        let outputs = scan_offer_creation_outputs(&parameters, &offer.get_script_pubkey(), tx)?;

        Some(ParsedOfferCreation {
            parameters,
            outputs,
        })
    }
}
