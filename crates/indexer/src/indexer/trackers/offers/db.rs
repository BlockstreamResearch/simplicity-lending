use sqlx::PgPool;
use uuid::Uuid;

use simplex::simplicityhl::elements::{OutPoint, Txid, hashes::Hash, hex::ToHex};

use crate::{
    db::DbTx,
    indexer::{OffersWatchEntry, WatchCache},
    models::{OfferStatus, OfferUtxoModel, UtxoType},
};

#[tracing::instrument(name = "Loading all active offer UTXOs from DB", skip(db))]
pub async fn load_offers_utxo_cache(db: &PgPool) -> anyhow::Result<WatchCache<OffersWatchEntry>> {
    let offer_rows = sqlx::query_as!(
        OfferUtxoModel,
        r#"
        SELECT 
            offer_id, 
            txid, 
            vout, 
            utxo_type AS "utxo_type: UtxoType", 
            created_at_height, 
            spent_txid, 
            spent_at_height
        FROM offer_utxos 
        WHERE spent_txid IS NULL
        "#
    )
    .fetch_all(db)
    .await
    .map_err(|e| {
        tracing::error!("Failed to load active offer UTXOs from DB: {e:?}");
        e
    })?;

    let offers_count = offer_rows.len();

    let mut cache = WatchCache::with_capacity(offers_count);

    for rec in offer_rows {
        let outpoint = OutPoint {
            txid: Txid::from_slice(&rec.txid)?,
            vout: rec.vout as u32,
        };
        cache.insert(
            outpoint,
            OffersWatchEntry {
                offer_id: rec.offer_id,
                utxo_type: rec.utxo_type,
            },
        );
    }

    tracing::info!(
        offers = offers_count,
        "Warm-up: Offers WatchCache populated"
    );

    Ok(cache)
}

#[tracing::instrument(
    name = "Marking offer UTXO as spent in DB",
    skip(sql_tx, out_point, block_height, txid),
    fields(
        spent_txid = %txid.to_hex(),
        txid = %out_point.txid.to_hex(),
        vout = %out_point.vout
    )
)]
pub async fn spend_offer_utxo(
    sql_tx: &mut DbTx<'_>,
    out_point: &OutPoint,
    block_height: u64,
    txid: Txid,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"
        UPDATE offer_utxos SET spent_txid = $1, spent_at_height = $2 WHERE txid = $3 AND vout = $4
        "#,
        txid.as_byte_array(),
        block_height as i64,
        out_point.txid.as_byte_array(),
        out_point.vout as i32
    )
    .execute(&mut **sql_tx)
    .await
    .map_err(|e| {
        tracing::error!("Failed to mark offer UTXO as spent: {e:?}");
        e
    })?;

    Ok(())
}

#[tracing::instrument(
    name = "Updating offer status in DB",
    skip(sql_tx),
    fields(offer_id = %offer_id, status = ?new_status)
)]
pub async fn update_offer_status(
    sql_tx: &mut DbTx<'_>,
    offer_id: Uuid,
    new_status: OfferStatus,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"
        UPDATE offers SET current_status = $1 WHERE id = $2
        "#,
        new_status as OfferStatus,
        offer_id,
    )
    .execute(&mut **sql_tx)
    .await
    .map_err(|e| {
        tracing::error!("Failed to update offer status: {e:?}");
        e
    })?;

    Ok(())
}

#[tracing::instrument(
    name = "Inserting offer UTXO into DB",
    skip(sql_tx, offer_utxo),
    fields(offer_id = %offer_utxo.offer_id, txid = %offer_utxo.txid.to_hex(), vout = %offer_utxo.vout)
)]
pub async fn insert_offer_utxo(
    sql_tx: &mut DbTx<'_>,
    offer_utxo: &OfferUtxoModel,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"
        INSERT INTO offer_utxos (
            offer_id, txid, vout, utxo_type, created_at_height, spent_txid, spent_at_height
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        "#,
        offer_utxo.offer_id,
        offer_utxo.txid,
        offer_utxo.vout,
        offer_utxo.utxo_type as UtxoType,
        offer_utxo.created_at_height,
        offer_utxo.spent_txid,
        offer_utxo.spent_at_height,
    )
    .execute(&mut **sql_tx)
    .await
    .map_err(|e| {
        tracing::error!("Failed to insert offer UXTO to the DB: {e:?}");
        e
    })?;

    Ok(())
}
