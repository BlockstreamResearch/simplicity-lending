use simplicityhl::elements::{OutPoint, Transaction, Txid, hashes::Hash};

use crate::indexer::db;
use crate::models::{OfferUtxoModel, UtxoType};
use crate::{
    db::DbTx,
    indexer::{ActiveUtxo, UtxoCache},
    models::OfferStatus,
};

#[tracing::instrument(
    name = "Handling lending creation",
    skip(sql_tx, cache, old_outpoint, utxo_info, txid, block_height),
    fields(offer_id = %utxo_info.offer_id, %txid, %block_height),
)]
pub async fn handle_lending_creation(
    sql_tx: &mut DbTx<'_>,
    cache: &mut UtxoCache,
    old_outpoint: &OutPoint,
    utxo_info: &ActiveUtxo,
    txid: Txid,
    block_height: u64,
) -> anyhow::Result<()> {
    db::spend_offer_utxo(sql_tx, old_outpoint, block_height, txid).await?;
    cache.remove(old_outpoint);

    db::update_offer_status(sql_tx, utxo_info.offer_id, OfferStatus::Active).await?;

    let lending_outpoint = OutPoint { txid, vout: 0 };
    let lending_offer_utxo = OfferUtxoModel {
        offer_id: utxo_info.offer_id,
        txid: lending_outpoint.txid.to_byte_array().to_vec(),
        vout: lending_outpoint.vout as i32,
        utxo_type: UtxoType::Lending,
        created_at_height: block_height as i64,
        spent_at_height: None,
        spent_txid: None,
    };

    db::insert_offer_utxo(sql_tx, &lending_offer_utxo).await?;

    cache.insert(
        lending_outpoint,
        ActiveUtxo {
            offer_id: utxo_info.offer_id,
            utxo_type: UtxoType::Lending,
        },
    );

    Ok(())
}

pub fn is_lending_creation_tx(tx: &Transaction, expected_principal_asset: &[u8]) -> bool {
    if tx.output.len() < 7 || tx.input.len() < 7 {
        return false;
    }

    if let Some(asset_id) = tx.output[1].asset.explicit() {
        return asset_id.into_inner().0.to_vec() == expected_principal_asset;
    }

    false
}
