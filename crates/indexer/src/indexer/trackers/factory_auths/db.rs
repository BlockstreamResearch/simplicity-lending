use sqlx::PgPool;
use uuid::Uuid;

use simplex::simplicityhl::elements::{OutPoint, Txid, hashes::Hash, hex::ToHex};

use crate::{db::DbTx, indexer::WatchCache, models::FactoryAuthModel};

#[tracing::instrument(name = "Loading all active factory auth UTXOs from DB", skip(db))]
pub async fn load_factory_auth_utxo_cache(db: &PgPool) -> anyhow::Result<WatchCache<Uuid>> {
    let factory_auths_rows = sqlx::query_as!(
        FactoryAuthModel,
        r#"
        SELECT
            factory_id,
            script_pubkey,
            txid,
            vout,
            created_at_height,
            spent_txid,
            spent_at_height
        FROM factory_auths
        WHERE spent_txid IS NULL
        "#
    )
    .fetch_all(db)
    .await
    .map_err(|e| {
        tracing::error!("Failed to load active factory auth UTXOs from DB: {e:?}");
        e
    })?;

    let factory_auth_count = factory_auths_rows.len();

    let mut cache = WatchCache::with_capacity(factory_auth_count);

    for rec in factory_auths_rows {
        let outpoint = OutPoint {
            txid: Txid::from_slice(&rec.txid)?,
            vout: rec.vout as u32,
        };
        cache.insert(outpoint, rec.factory_id);
    }

    tracing::info!(
        factory_auths = factory_auth_count,
        "Warm-up: Factory auths WatchCache populated"
    );

    Ok(cache)
}

#[tracing::instrument(
    name = "Inserting factory auth UTXO into DB",
    skip(sql_tx, factory_auth_utxo),
    fields(factory_id = %factory_auth_utxo.factory_id, txid = %factory_auth_utxo.txid.to_hex(), vout = %factory_auth_utxo.vout)
)]
pub async fn insert_factory_auth_utxo(
    sql_tx: &mut DbTx<'_>,
    factory_auth_utxo: &FactoryAuthModel,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        INSERT INTO factory_auths (
            factory_id, script_pubkey, txid, vout, created_at_height, spent_txid,
            spent_at_height
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        "#,
        factory_auth_utxo.factory_id,
        factory_auth_utxo.script_pubkey,
        factory_auth_utxo.txid,
        factory_auth_utxo.vout,
        factory_auth_utxo.created_at_height,
        factory_auth_utxo.spent_txid,
        factory_auth_utxo.spent_at_height,
    )
    .execute(&mut **sql_tx)
    .await
    .map_err(|e| {
        tracing::error!("Failed to insert factory auth UTXO: {e:?}");
        e
    })?;

    Ok(())
}

#[tracing::instrument(
    name = "Marking factory auth UTXO as spent in DB",
    skip(sql_tx, outpoint, block_height, txid),
    fields(
        spent_txid = %txid.to_hex(),
        txid = %outpoint.txid.to_hex(),
        vout = %outpoint.vout
    )
)]
pub async fn spend_factory_auth_utxo(
    sql_tx: &mut DbTx<'_>,
    outpoint: &OutPoint,
    block_height: u64,
    txid: Txid,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"
        UPDATE factory_auths SET spent_txid = $1, spent_at_height = $2 WHERE txid = $3 AND vout = $4
        "#,
        txid.as_byte_array(),
        block_height as i64,
        outpoint.txid.as_byte_array(),
        outpoint.vout as i32
    )
    .execute(&mut **sql_tx)
    .await
    .map_err(|e| {
        tracing::error!("Failed to mark factory auth UTXO as spent: {e:?}");
        e
    })?;

    Ok(())
}
