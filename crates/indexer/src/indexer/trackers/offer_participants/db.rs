use sqlx::PgPool;
use uuid::Uuid;

use simplex::simplicityhl::elements::{OutPoint, Txid, hashes::Hash, hex::ToHex};

use crate::{
    db::DbTx,
    indexer::{ParticipantWatchEntry, WatchCache},
    models::{OfferParticipantModel, ParticipantType},
};

#[tracing::instrument(name = "Loading all active offer participant UTXOs from DB", skip(db))]
pub async fn load_participants_utxo_cache(
    db: &PgPool,
) -> anyhow::Result<WatchCache<ParticipantWatchEntry>> {
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

    let offer_participants_count = participant_rows.len();

    let mut cache = WatchCache::with_capacity(offer_participants_count);

    for rec in participant_rows {
        let outpoint = OutPoint {
            txid: Txid::from_slice(&rec.txid)?,
            vout: rec.vout as u32,
        };
        cache.insert(
            outpoint,
            ParticipantWatchEntry {
                offer_id: rec.offer_id,
                participant_type: rec.participant_type,
            },
        );
    }

    tracing::info!(
        participants = offer_participants_count,
        "Warm-up: Offer participants WatchCache populated"
    );

    Ok(cache)
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

#[tracing::instrument(
    name = "Inserting offer participant UTXO into DB",
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
    name = "Marking offer participant UTXO as spent in DB",
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
