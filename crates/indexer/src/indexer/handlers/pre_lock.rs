use simplex::simplicityhl::elements::{OutPoint, Transaction, hashes::Hash};

use lending_contracts::programs::{PreLock, PreLockParameters, program::SimplexProgram};
use lending_contracts::transactions::pre_lock::extract_pre_lock_parameters_from_tx;

use crate::esplora_client::EsploraClient;
use crate::indexer::{cache::UtxoCache, db};
use crate::models::{OfferModel, OfferUtxoModel, UtxoType};
use crate::{
    db::DbTx,
    models::{ActiveUtxo, OfferParticipantModel, ParticipantType, UtxoData},
};

#[tracing::instrument(
    name = "Handling pre lock creation transaction",
    skip(sql_tx, pre_lock_params, tx, block_height),
    fields(txid = %tx.txid(), %block_height),
)]
pub async fn handle_pre_lock_creation(
    sql_tx: &mut DbTx<'_>,
    cache: &mut UtxoCache,
    pre_lock_params: PreLockParameters,
    tx: &Transaction,
    block_height: u64,
) -> anyhow::Result<()> {
    let txid = tx.txid();

    if tx.output.len() < 7 {
        return Err(anyhow::anyhow!(
            "Malformed PreLock transaction {}: expected at least 6 outputs, found {}",
            txid,
            tx.output.len()
        ));
    }

    let offer_model = OfferModel::new(&pre_lock_params, block_height, txid);

    db::insert_offer(sql_tx, &offer_model).await?;

    let pre_lock_outpoint = OutPoint { txid, vout: 0 };
    let pre_lock_offer_utxo = OfferUtxoModel {
        offer_id: offer_model.id,
        txid: txid.to_byte_array().to_vec(),
        vout: 0,
        utxo_type: UtxoType::PreLock,
        created_at_height: block_height as i64,
        spent_at_height: None,
        spent_txid: None,
    };

    db::insert_offer_utxo(sql_tx, &pre_lock_offer_utxo).await?;
    cache.insert(
        pre_lock_outpoint,
        ActiveUtxo {
            offer_id: offer_model.id,
            data: UtxoData::Offer(UtxoType::PreLock),
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

pub fn is_pre_lock_creation_tx(
    tx: &Transaction,
    client: &EsploraClient,
) -> Option<PreLockParameters> {
    let pre_lock_parameters =
        extract_pre_lock_parameters_from_tx(tx, &client.to_simplex_provider()).ok()?;

    let pre_lock = PreLock::new(pre_lock_parameters);
    let pre_lock_script_pubkey = pre_lock.get_script_pubkey();

    if tx.output.first().unwrap().script_pubkey != pre_lock_script_pubkey {
        return None;
    }

    Some(pre_lock_parameters)
}

#[cfg(test)]
mod tests {
    use super::is_pre_lock_creation_tx;
    use crate::esplora_client::EsploraClient;
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

        let client = EsploraClient::new();

        assert!(is_pre_lock_creation_tx(&tx, &client).is_none());
    }

    #[test]
    fn returns_none_when_outputs_less_than_7() {
        let tx = make_tx_with_inputs(
            5,
            vec![
                normal_output(),
                normal_output(),
                normal_output(),
                normal_output(),
                normal_output(),
                null_output(),
            ],
        );

        let client = EsploraClient::new();

        assert!(is_pre_lock_creation_tx(&tx, &client).is_none());
    }

    #[test]
    fn returns_none_when_output_5_is_not_null_data() {
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

        let client = EsploraClient::new();

        assert!(is_pre_lock_creation_tx(&tx, &client).is_none());
    }
}
