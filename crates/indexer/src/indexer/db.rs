use std::collections::HashMap;

use simplicityhl::elements::{OutPoint, Txid, hashes::Hash};
use sqlx::PgPool;
use uuid::Uuid;

use crate::models::{OfferUtxoModel, UtxoType};

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
    _offer_id: Uuid,
    _utxo_type: UtxoType,
}

pub type UtxoCache = HashMap<OutPoint, ActiveUtxo>;

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
    .await?;

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
                _offer_id: rec.offer_id,
                _utxo_type: rec.utxo_type,
            },
        );
    }

    tracing::info!("Loaded {} active UTXOs from database", active_utxos.len());

    Ok(active_utxos)
}
