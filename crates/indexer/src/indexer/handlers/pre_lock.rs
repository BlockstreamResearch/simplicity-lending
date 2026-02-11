use simplicityhl::elements::{Transaction, Txid, hashes::Hash};

use lending_contracts::{
    pre_lock::{build_arguments::PreLockArguments, get_pre_lock_address},
    sdk::{extract_arguments_from_tx, taproot_unspendable_internal_key},
};

use crate::db::DbTx;
use crate::indexer::db;
use crate::models::{OfferModel, OfferUtxoModel, UtxoType};

#[tracing::instrument(
    name = "Handling pre lock creation transaction",
    skip(sql_tx, pre_lock_args, txid, block_height),
    fields(%txid, %block_height),
)]
pub async fn handle_pre_lock_creation(
    sql_tx: &mut DbTx<'_>,
    pre_lock_args: PreLockArguments,
    txid: Txid,
    block_height: u64,
) -> anyhow::Result<()> {
    let offer_model = OfferModel::new(&pre_lock_args, block_height, txid);

    db::insert_offer(sql_tx, &offer_model).await?;

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
