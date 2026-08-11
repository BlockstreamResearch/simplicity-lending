use uuid::Uuid;

use simplex::{
    provider::SimplicityNetwork,
    simplicityhl::elements::{AssetId, Transaction, hex::ToHex},
};

use lending_contracts::programs::lending::{LendingOffer, LendingOfferParameters};

use crate::{
    api::utils::format_hex,
    db::DbTx,
    events::{IndexerEvent, notify_indexer_event},
    indexer::{
        AssetContractKind, AssetRegistration, OfferCreationOutputs, OfferParticipantsTracker,
        OffersTracker, ParticipantCreationUtxo, trackers::offers_creation::insert_offer,
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
    asset_registration: Option<AssetRegistration>,
}

impl OfferCreationsTracker {
    pub fn new(
        protocol_fee_keeper_asset_id: AssetId,
        network: SimplicityNetwork,
        asset_registration: Option<AssetRegistration>,
    ) -> Self {
        Self {
            protocol_fee_keeper_asset_id,
            network,
            asset_registration,
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
            self.handle_offer_creation(
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

    #[allow(clippy::too_many_arguments)]
    async fn handle_offer_creation(
        &self,
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

        let Some(offer_id) = insert_offer(sql_tx, &offer_model).await? else {
            tracing::debug!(%txid, "Offer already indexed, skipping");
            return Ok(());
        };

        offers
            .seed_creation_pending_offer_utxo(
                sql_tx,
                offer_id,
                txid,
                creation.outputs.pending_offer_vout,
                block_height,
            )
            .await?;

        notify_indexer_event(
            sql_tx,
            &IndexerEvent::OfferCreated {
                id: offer_id.to_string(),
                issuance_factory_id: factory_id,
                height: block_height,
                created_at_txid: format_hex(offer_model.created_at_txid),
                borrower_script_pubkey: creation.outputs.borrower_nft_script_pubkey.to_hex(),
            },
        )
        .await?;

        participants
            .seed_creation_participant_utxo(
                sql_tx,
                offer_id,
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
                offer_id,
                ParticipantType::Lender,
                ParticipantCreationUtxo {
                    txid,
                    vout: creation.outputs.lender_nft_vout,
                    script_pubkey: creation.outputs.lender_nft_script_pubkey,
                },
                block_height,
            )
            .await?;

        // Best-effort ELIP-0100 metadata registration for the offer NFTs,
        // mirroring the factory asset flow: when the creation committed the
        // expected contract, submit it to the registry. Verifying the metadata
        // remains the wallets' responsibility.
        if let Some(registration) = &self.asset_registration {
            for (kind, asset_id) in [
                (
                    AssetContractKind::BorrowerNft,
                    creation.parameters.borrower_nft_asset_id,
                ),
                (
                    AssetContractKind::LenderNft,
                    creation.parameters.lender_nft_asset_id,
                ),
            ] {
                if let Some(contract) = registration.verified_contract(kind, tx, asset_id) {
                    registration.spawn_registration(asset_id, contract);
                }
            }
        }

        Ok(())
    }

    fn parse_offer_creation_tx(&self, tx: &Transaction) -> Option<ParsedOfferCreation> {
        let created =
            LendingOffer::try_from_tx(tx, self.protocol_fee_keeper_asset_id, self.network).ok()?;

        let parameters = *created.offer.get_parameters();
        let outputs = OfferCreationOutputs {
            pending_offer_vout: created.pending_offer_vout,
            borrower_nft_vout: created.borrower_nft_vout,
            borrower_nft_script_pubkey: created.borrower_nft_script_pubkey.to_bytes(),
            lender_nft_vout: created.lender_nft_vout,
            lender_nft_script_pubkey: created.lender_nft_script_pubkey.to_bytes(),
        };

        Some(ParsedOfferCreation {
            parameters,
            outputs,
        })
    }
}
