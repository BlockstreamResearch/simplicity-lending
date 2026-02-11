use std::collections::HashMap;

use simplicityhl::elements::{OutPoint, Txid, hashes::Hash, hex::ToHex};
use sqlx::PgPool;
use uuid::Uuid;

use crate::db::DbTx;
use crate::models::{OfferModel, OfferStatus, OfferUtxoModel, UtxoType};

#[tracing::instrument(
    name = "Upserting new sync state into DB",
    skip(sql_tx, height, hash),
    fields(last_indexed_height = %height, last_indexed_hash = %hash),
)]
pub async fn upsert_sync_state(
    sql_tx: &mut DbTx<'_>,
    height: u64,
    hash: String,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"
        INSERT INTO sync_state (id, last_indexed_height, last_indexed_hash)
        VALUES (1, $1, $2)
        ON CONFLICT (id) DO UPDATE SET
            last_indexed_height = EXCLUDED.last_indexed_height,
            last_indexed_hash = EXCLUDED.last_indexed_hash,
            updated_at = NOW()
        "#,
        height as i64,
        hash,
    )
    .execute(&mut **sql_tx)
    .await
    .map_err(|e| {
        tracing::error!("Failed to upsert sync state: {e:?}");
        e
    })?;

    Ok(())
}

#[tracing::instrument(
    name = "Inserting offer into DB",
    skip(sql_tx, offer),
    fields(offer_id = %offer.id)
)]
pub async fn insert_offer(sql_tx: &mut DbTx<'_>, offer: &OfferModel) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"
        INSERT INTO offers (
            id, borrower_pub_key, collateral_asset_id, principal_asset_id,
            first_parameters_nft_asset_id, second_parameters_nft_asset_id,
            borrower_nft_asset_id, lender_nft_asset_id,
            collateral_amount, principal_amount, interest_rate,
            loan_expiration_time, created_at_height, created_at_txid
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        ON CONFLICT (created_at_txid) DO NOTHING
        "#,
        offer.id,
        offer.borrower_pub_key,
        offer.collateral_asset_id,
        offer.principal_asset_id,
        offer.first_parameters_nft_asset_id,
        offer.second_parameters_nft_asset_id,
        offer.borrower_nft_asset_id,
        offer.lender_nft_asset_id,
        offer.collateral_amount,
        offer.principal_amount,
        offer.interest_rate,
        offer.loan_expiration_time,
        offer.created_at_height,
        offer.created_at_txid,
    )
    .execute(&mut **sql_tx)
    .await
    .map_err(|e| {
        tracing::error!("Failed to insert offer to the DB: {e:?}");
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
            offer_id, txid, vout, utxo_type, created_at_height
        ) VALUES ($1, $2, $3, $4, $5)
        "#,
        offer_utxo.offer_id,
        offer_utxo.txid,
        offer_utxo.vout,
        offer_utxo.utxo_type as UtxoType,
        offer_utxo.created_at_height
    )
    .execute(&mut **sql_tx)
    .await
    .map_err(|e| {
        tracing::error!("Failed to insert offer UXTO to the DB: {e:?}");
        e
    })?;

    Ok(())
}

#[tracing::instrument(
    name = "Marking UTXO as spent in DB",
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
        tracing::error!("Failed to mark UTXO as spent: {e:?}");
        e
    })?;

    Ok(())
}

#[tracing::instrument(name = "Getting start indexing block height", skip(db))]
pub async fn get_starting_height(db: &PgPool, config_height: u64) -> u64 {
    let row = sqlx::query!("SELECT last_indexed_height FROM sync_state WHERE id = 1")
        .fetch_optional(db)
        .await
        .unwrap_or(None);

    match row {
        Some(r) => r.last_indexed_height as u64,
        None => {
            tracing::info!(
                "No sync state found in DB, starting from config: {}",
                config_height
            );
            config_height
        }
    }
}

pub struct ActiveUtxo {
    pub offer_id: Uuid,
    pub utxo_type: UtxoType,
}

pub type UtxoCache = HashMap<OutPoint, ActiveUtxo>;

#[tracing::instrument(name = "Loading active UTXOs from DB", skip(db))]
pub async fn load_active_utxos(db: &PgPool) -> anyhow::Result<UtxoCache> {
    let rows = sqlx::query_as!(
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
        tracing::error!("Failed to load active UTXOs from DB: {e:?}");
        e
    })?;

    let mut active_utxos: UtxoCache = HashMap::with_capacity(rows.len());

    for rec in rows {
        let txid =
            Txid::from_slice(&rec.txid).map_err(|e| anyhow::anyhow!("Invalid txid in DB: {e}"))?;
        let outpoint = OutPoint {
            txid,
            vout: rec.vout as u32,
        };

        active_utxos.insert(
            outpoint,
            ActiveUtxo {
                offer_id: rec.offer_id,
                utxo_type: rec.utxo_type,
            },
        );
    }

    tracing::info!("Loaded {} active UTXOs from database", active_utxos.len());

    Ok(active_utxos)
}
