use simplicityhl::elements::{OutPoint, Txid, hashes::Hash};

use crate::indexer::db;
use crate::models::{OfferUtxoModel, UtxoType};
use crate::{
    db::DbTx,
    indexer::{ActiveUtxo, UtxoCache},
    models::OfferStatus,
};

#[tracing::instrument(
    name = "Handling repayment tokens claim",
    skip(sql_tx, cache, old_outpoint, utxo_info, txid, block_height),
    fields(offer_id = %utxo_info.offer_id, %txid, %block_height),
)]
pub async fn handle_repayment_claim(
    sql_tx: &mut DbTx<'_>,
    cache: &mut UtxoCache,
    old_outpoint: &OutPoint,
    utxo_info: &ActiveUtxo,
    txid: Txid,
    block_height: u64,
) -> anyhow::Result<()> {
    db::spend_offer_utxo(sql_tx, old_outpoint, block_height, txid).await?;
    cache.remove(old_outpoint);

    db::update_offer_status(sql_tx, utxo_info.offer_id, OfferStatus::Cancelled).await?;

    let claim_outpoint = OutPoint { txid, vout: 1 };

    let claim_utxo = OfferUtxoModel {
        offer_id: utxo_info.offer_id,
        txid: claim_outpoint.txid.to_byte_array().to_vec(),
        vout: claim_outpoint.vout as i32,
        utxo_type: UtxoType::Claim,
        created_at_height: block_height as i64,

        // Marked as spent immediately to:
        // 1. Exclude from cache on restart (WHERE spent_txid IS NULL)
        // 2. Preserve a permanent audit trail in database
        spent_at_height: Some(block_height as i64),
        spent_txid: Some(txid.to_byte_array().to_vec()),
    };

    db::insert_offer_utxo(sql_tx, &claim_utxo).await?;

    tracing::info!(offer_id = %utxo_info.offer_id, "Offer archived");
    Ok(())
}
