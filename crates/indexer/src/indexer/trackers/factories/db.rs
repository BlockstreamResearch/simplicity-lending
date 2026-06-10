use sqlx::PgPool;
use uuid::Uuid;

use simplex::simplicityhl::elements::{OutPoint, Txid, hashes::Hash, hex::ToHex};

use crate::{db::DbTx, models::FactoryIdentity};

use crate::{
    indexer::WatchCache,
    models::{FactoryStatus, FactoryUtxoModel},
};

#[tracing::instrument(name = "Loading all active factory UTXOs from DB", skip(db))]
pub async fn load_factory_utxos_cache(db: &PgPool) -> anyhow::Result<WatchCache<Uuid>> {
    let factory_rows = sqlx::query_as!(
        FactoryUtxoModel,
        r#"
        SELECT 
            factory_id,
            txid,
            vout,
            created_at_height,
            spent_txid,
            spent_at_height
        FROM factory_utxos 
        WHERE spent_txid IS NULL
        "#
    )
    .fetch_all(db)
    .await
    .map_err(|e| {
        tracing::error!("Failed to load active factory UTXOs from DB: {e:?}");
        e
    })?;

    let factories_count = factory_rows.len();

    let mut cache = WatchCache::with_capacity(factories_count);

    for rec in factory_rows {
        let outpoint = OutPoint {
            txid: Txid::from_slice(&rec.txid)?,
            vout: rec.vout as u32,
        };
        cache.insert(outpoint, rec.factory_id);
    }

    tracing::info!(
        factories = factories_count,
        "Warm-up: Factories WatchCache populated"
    );

    Ok(cache)
}

#[tracing::instrument(
    name = "Marking factory UTXO as spent in DB",
    skip(sql_tx, outpoint, block_height, txid),
    fields(
        spent_txid = %txid.to_hex(),
        txid = %outpoint.txid.to_hex(),
        vout = %outpoint.vout
    )
)]
pub async fn spend_factory_utxo(
    sql_tx: &mut DbTx<'_>,
    outpoint: &OutPoint,
    block_height: u64,
    txid: Txid,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"
        UPDATE factory_utxos SET spent_txid = $1, spent_at_height = $2 WHERE txid = $3 AND vout = $4
        "#,
        txid.as_byte_array(),
        block_height as i64,
        outpoint.txid.as_byte_array(),
        outpoint.vout as i32
    )
    .execute(&mut **sql_tx)
    .await
    .map_err(|e| {
        tracing::error!("Failed to mark factory UTXO as spent: {e:?}");
        e
    })?;

    Ok(())
}

#[tracing::instrument(
    name = "Updating factory status in DB",
    skip(sql_tx),
    fields(factory_id = %factory_id, status = ?new_status)
)]
pub async fn update_factory_status(
    sql_tx: &mut DbTx<'_>,
    factory_id: Uuid,
    new_status: FactoryStatus,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"
        UPDATE factories SET current_status = $1 WHERE id = $2
        "#,
        new_status as FactoryStatus,
        factory_id,
    )
    .execute(&mut **sql_tx)
    .await
    .map_err(|e| {
        tracing::error!("Failed to update factory status: {e:?}");
        e
    })?;

    Ok(())
}

#[tracing::instrument(
    name = "Inserting factory UTXO into DB",
    skip(sql_tx, factory_utxo),
    fields(factory_id = %factory_utxo.factory_id, txid = %factory_utxo.txid.to_hex(), vout = %factory_utxo.vout)
)]
pub async fn insert_factory_utxo(
    sql_tx: &mut DbTx<'_>,
    factory_utxo: &FactoryUtxoModel,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        INSERT INTO factory_utxos (
            factory_id, txid, vout, created_at_height, spent_txid, spent_at_height
        ) VALUES ($1, $2, $3, $4, $5, $6)
        "#,
        factory_utxo.factory_id,
        factory_utxo.txid,
        factory_utxo.vout,
        factory_utxo.created_at_height,
        factory_utxo.spent_txid,
        factory_utxo.spent_at_height,
    )
    .execute(&mut **sql_tx)
    .await
    .map_err(|e| {
        tracing::error!("Failed to insert factory UXTO to the DB: {e:?}");
        e
    })?;

    Ok(())
}

#[tracing::instrument(
    name = "Getting factory identity from DB",
    skip(sql_tx),
    fields(%factory_id)
)]
pub async fn get_factory_identity(
    sql_tx: &mut DbTx<'_>,
    factory_id: Uuid,
) -> Result<FactoryIdentity, sqlx::Error> {
    let factory_row = sqlx::query_as!(
        FactoryIdentity,
        r#"
        SELECT factory_asset_id, program_script_pubkey
        FROM factories
        WHERE id = $1
        "#,
        factory_id
    )
    .fetch_one(&mut **sql_tx)
    .await
    .map_err(|e| {
        tracing::error!("Failed to get factory identity: {e:?}");
        e
    })?;

    Ok(FactoryIdentity {
        factory_asset_id: factory_row.factory_asset_id,
        program_script_pubkey: factory_row.program_script_pubkey,
    })
}
