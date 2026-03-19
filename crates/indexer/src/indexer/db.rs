use simplicityhl::elements::{OutPoint, Txid, hashes::Hash, hex::ToHex};
use sqlx::PgPool;
use uuid::Uuid;

use crate::db::DbTx;
use crate::indexer::cache::UtxoCache;
use crate::models::{
    ActiveUtxo, OfferModel, OfferParticipantModel, OfferStatus, OfferUtxoModel, ParticipantType,
    UtxoData, UtxoType,
};

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
            id, borrower_pubkey, collateral_asset_id, principal_asset_id,
            first_parameters_nft_asset_id, second_parameters_nft_asset_id,
            borrower_nft_asset_id, lender_nft_asset_id,
            collateral_amount, principal_amount, interest_rate,
            loan_expiration_time, created_at_height, created_at_txid
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        ON CONFLICT (created_at_txid) DO NOTHING
        "#,
        offer.id,
        offer.borrower_pubkey,
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
    name = "Inserting participant UTXO into DB",
    skip(sql_tx, participant_utxo),
    fields(offer_id = %participant_utxo.offer_id, txid = %participant_utxo.txid.to_hex(), vout = %participant_utxo.vout)
)]
pub async fn insert_participant_utxo(
    sql_tx: &mut DbTx<'_>,
    participant_utxo: &OfferParticipantModel,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        INSERT INTO offer_participants (
            offer_id, participant_type, script_pubkey, txid, vout, created_at_height, spent_txid,
            spent_at_height
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        "#,
        participant_utxo.offer_id,
        participant_utxo.participant_type as ParticipantType,
        participant_utxo.script_pubkey,
        participant_utxo.txid,
        participant_utxo.vout,
        participant_utxo.created_at_height,
        participant_utxo.spent_txid,
        participant_utxo.spent_at_height,
    )
    .execute(&mut **sql_tx)
    .await
    .map_err(|e| {
        tracing::error!("Failed to insert participant UTXO: {e:?}");
        e
    })?;

    Ok(())
}

#[tracing::instrument(
    name = "Marking participant UTXO as spent in DB",
    skip(sql_tx, out_point, block_height, txid),
    fields(
        spent_txid = %txid.to_hex(),
        txid = %out_point.txid.to_hex(),
        vout = %out_point.vout
    )
)]
pub async fn spend_participant_utxo(
    sql_tx: &mut DbTx<'_>,
    out_point: &OutPoint,
    block_height: u64,
    txid: Txid,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"
        UPDATE offer_participants SET spent_txid = $1, spent_at_height = $2 WHERE txid = $3 AND vout = $4
        "#,
        txid.as_byte_array(),
        block_height as i64,
        out_point.txid.as_byte_array(),
        out_point.vout as i32
    )
    .execute(&mut **sql_tx)
    .await
    .map_err(|e| {
        tracing::error!("Failed to mark participant UTXO as spent: {e:?}");
        e
    })?;

    Ok(())
}

#[tracing::instrument(name = "Getting last indexed block height", skip(db))]
pub async fn get_last_indexed_height(db: &PgPool, config_height: u64) -> Result<u64, sqlx::Error> {
    let row = sqlx::query!("SELECT last_indexed_height FROM sync_state WHERE id = 1")
        .fetch_optional(db)
        .await?;

    match row {
        Some(r) => Ok(r.last_indexed_height as u64),
        None => {
            tracing::info!(
                "No sync state found in DB, starting from config: {}",
                config_height
            );
            Ok(config_height)
        }
    }
}

#[tracing::instrument(
    name = "Getting offer participant asset id",
    skip(sql_tx, offer_id, participant_type)
    fields(%offer_id, ?participant_type)
)]
pub async fn get_offer_participant_asset_id(
    sql_tx: &mut DbTx<'_>,
    offer_id: Uuid,
    participant_type: ParticipantType,
) -> Result<Vec<u8>, sqlx::Error> {
    let offer_row = sqlx::query!(
        r#"SELECT borrower_nft_asset_id, lender_nft_asset_id FROM offers WHERE id = $1"#,
        offer_id
    )
    .fetch_one(&mut **sql_tx)
    .await
    .map_err(|e| {
        tracing::error!("Failed to get offer access asset ids: {e:?}");
        e
    })?;

    match participant_type {
        ParticipantType::Borrower => Ok(offer_row.borrower_nft_asset_id),
        ParticipantType::Lender => Ok(offer_row.lender_nft_asset_id),
    }
}

#[tracing::instrument(name = "Loading all active UTXOs from DB", skip(db))]
pub async fn load_utxo_cache(db: &PgPool) -> anyhow::Result<UtxoCache> {
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

    let participant_rows = sqlx::query_as!(
        OfferParticipantModel,
        r#"
        SELECT
            offer_id,
            participant_type as "participant_type: ParticipantType",
            script_pubkey,
            txid,
            vout,
            created_at_height,
            spent_txid,
            spent_at_height
        FROM offer_participants
        WHERE spent_txid IS NULL
        "#
    )
    .fetch_all(db)
    .await
    .map_err(|e| {
        tracing::error!("Failed to load active participant UTXOs from DB: {e:?}");
        e
    })?;

    let offers_count = offer_rows.len();
    let offer_participants_count = participant_rows.len();

    let mut cache = UtxoCache::with_capacity(offers_count + offer_participants_count);

    for rec in offer_rows {
        let outpoint = OutPoint {
            txid: Txid::from_slice(&rec.txid)?,
            vout: rec.vout as u32,
        };
        cache.insert(
            outpoint,
            ActiveUtxo {
                offer_id: rec.offer_id,
                data: UtxoData::Offer(rec.utxo_type),
            },
        );
    }

    for rec in participant_rows {
        let outpoint = OutPoint {
            txid: Txid::from_slice(&rec.txid)?,
            vout: rec.vout as u32,
        };
        cache.insert(
            outpoint,
            ActiveUtxo {
                offer_id: rec.offer_id,
                data: UtxoData::Participant(rec.participant_type),
            },
        );
    }

    tracing::info!(
        offers = offers_count,
        participants = offer_participants_count,
        "Warm-up: UtxoCache populated"
    );

    Ok(cache)
}
