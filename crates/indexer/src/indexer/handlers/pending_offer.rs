use lending_contracts::programs::program::SimplexProgram;
use simplex::provider::SimplicityNetwork;
use simplex::simplicityhl::elements::AssetId;
use simplex::simplicityhl::elements::{OutPoint, Transaction, hashes::Hash};

use lending_contracts::programs::lending::{LendingOffer, LendingOfferParameters};

use crate::indexer::{cache::UtxoCache, db};
use crate::models::{OfferModel, OfferUtxoModel, UtxoType};
use crate::{
    db::DbTx,
    models::{ActiveUtxo, OfferParticipantModel, ParticipantType, UtxoData},
};

#[tracing::instrument(
    name = "Handling offer creation transaction",
    skip(sql_tx, offer_parameters, tx, block_height),
    fields(txid = %tx.txid(), %block_height),
)]
pub async fn handle_pending_offer_creation(
    sql_tx: &mut DbTx<'_>,
    cache: &mut UtxoCache,
    offer_parameters: LendingOfferParameters,
    tx: &Transaction,
    block_height: u64,
) -> anyhow::Result<()> {
    let txid = tx.txid();

    if tx.output.len() < 4 {
        return Err(anyhow::anyhow!(
            "Malformed offer creation transaction {}: expected at least 4 outputs, found {}",
            txid,
            tx.output.len()
        ));
    }

    let offer_model = OfferModel::new(&offer_parameters, block_height, txid);

    if db::insert_offer(sql_tx, &offer_model).await?.is_none() {
        tracing::debug!(%txid, "Offer already indexed, skipping");
        return Ok(());
    }

    let lending_offer_outpoint = OutPoint { txid, vout: 0 };
    let lending_offer_utxo = OfferUtxoModel {
        offer_id: offer_model.id,
        txid: txid.to_byte_array().to_vec(),
        vout: 0,
        utxo_type: UtxoType::PendingOffer,
        created_at_height: block_height as i64,
        spent_at_height: None,
        spent_txid: None,
    };

    db::insert_offer_utxo(sql_tx, &lending_offer_utxo).await?;
    cache.insert(
        lending_offer_outpoint,
        ActiveUtxo {
            offer_id: offer_model.id,
            data: UtxoData::Offer(UtxoType::PendingOffer),
        },
    );

    let borrower_nft_outpoint = OutPoint { txid, vout: 3 };
    let borrower_participant_utxo = OfferParticipantModel {
        offer_id: offer_model.id,
        participant_type: ParticipantType::Borrower,
        script_pubkey: tx.output[3].script_pubkey.to_bytes().to_vec(),
        txid: txid.to_byte_array().to_vec(),
        vout: borrower_nft_outpoint.vout as i32,
        created_at_height: block_height as i64,
        spent_txid: None,
        spent_at_height: None,
    };
    db::insert_participant_utxo(sql_tx, &borrower_participant_utxo).await?;
    cache.insert(
        borrower_nft_outpoint,
        ActiveUtxo {
            offer_id: offer_model.id,
            data: UtxoData::Participant(ParticipantType::Borrower),
        },
    );

    let lender_nft_outpoint = OutPoint { txid, vout: 4 };
    let lender_participant_utxo = OfferParticipantModel {
        offer_id: offer_model.id,
        participant_type: ParticipantType::Lender,
        script_pubkey: tx.output[4].script_pubkey.to_bytes().to_vec(),
        txid: txid.to_byte_array().to_vec(),
        vout: lender_nft_outpoint.vout as i32,
        created_at_height: block_height as i64,
        spent_txid: None,
        spent_at_height: None,
    };
    db::insert_participant_utxo(sql_tx, &lender_participant_utxo).await?;
    cache.insert(
        lender_nft_outpoint,
        ActiveUtxo {
            offer_id: offer_model.id,
            data: UtxoData::Participant(ParticipantType::Lender),
        },
    );

    Ok(())
}

pub fn is_offer_creation_tx(
    tx: &Transaction,
    protocol_fee_keeper_asset_id: AssetId,
) -> Option<LendingOfferParameters> {
    // TODO: Move network to config
    let offer = LendingOffer::try_from_tx(
        tx,
        protocol_fee_keeper_asset_id,
        SimplicityNetwork::LiquidTestnet,
    )
    .ok()?;

    let offer_script_pubkey = offer.get_script_pubkey();

    // TODO: Get UTXO indexes from the PendingLendingOffer program
    if tx.output[3].script_pubkey != offer_script_pubkey {
        return None;
    }

    Some(*offer.get_parameters())
}

#[cfg(test)]
mod tests {
    use simplex::simplicityhl::elements::AssetId;

    use super::is_offer_creation_tx;
    use crate::indexer::handlers::test_utils::{make_tx_with_inputs, normal_output, null_output};

    #[test]
    fn returns_none_when_inputs_less_than_5() {
        let tx = make_tx_with_inputs(
            4,
            vec![
                normal_output(),
                normal_output(),
                normal_output(),
                normal_output(),
                normal_output(),
                null_output(),
                normal_output(),
            ],
        );

        assert!(is_offer_creation_tx(&tx, AssetId::default()).is_none());
    }

    #[test]
    fn returns_none_when_outputs_less_than_5() {
        let tx = make_tx_with_inputs(
            5,
            vec![
                normal_output(),
                normal_output(),
                normal_output(),
                normal_output(),
            ],
        );

        assert!(is_offer_creation_tx(&tx, AssetId::default()).is_none());
    }

    #[test]
    fn returns_none_when_output_4_is_not_null_data() {
        let tx = make_tx_with_inputs(
            5,
            vec![
                normal_output(),
                normal_output(),
                normal_output(),
                normal_output(),
                normal_output(),
                normal_output(),
                normal_output(),
            ],
        );

        assert!(is_offer_creation_tx(&tx, AssetId::default()).is_none());
    }
}
