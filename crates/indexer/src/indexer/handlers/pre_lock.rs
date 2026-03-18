use simplicityhl::elements::{OutPoint, Transaction, hashes::Hash};

use lending_contracts::{
    pre_lock::{build_arguments::PreLockArguments, get_pre_lock_address},
    sdk::{extract_arguments_from_tx, taproot_unspendable_internal_key},
};

use crate::indexer::{cache::UtxoCache, db};
use crate::models::{OfferModel, OfferUtxoModel, UtxoType};
use crate::{
    db::DbTx,
    models::{ActiveUtxo, OfferParticipantModel, ParticipantType, UtxoData},
};

#[tracing::instrument(
    name = "Handling pre lock creation transaction",
    skip(sql_tx, pre_lock_args, tx, block_height),
    fields(txid = %tx.txid(), %block_height),
)]
pub async fn handle_pre_lock_creation(
    sql_tx: &mut DbTx<'_>,
    cache: &mut UtxoCache,
    pre_lock_args: PreLockArguments,
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

    let offer_model = OfferModel::new(&pre_lock_args, block_height, txid);

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

pub fn is_pre_lock_creation_tx(tx: &Transaction) -> Option<PreLockArguments> {
    let pre_lock_args =
        extract_arguments_from_tx(tx, simplicityhl_core::SimplicityNetwork::LiquidTestnet).ok()?;

    let expected_pre_lock_address = get_pre_lock_address(
        &taproot_unspendable_internal_key(),
        &pre_lock_args,
        simplicityhl_core::SimplicityNetwork::LiquidTestnet,
    )
    .ok()?;

    if tx.output.first().unwrap().script_pubkey != expected_pre_lock_address.script_pubkey() {
        return None;
    }

    Some(pre_lock_args)
}
