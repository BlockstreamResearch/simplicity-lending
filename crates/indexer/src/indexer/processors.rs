use sqlx::PgPool;

use simplicityhl::elements::Transaction;

use uuid::Uuid;

use crate::{
    esplora_client::EsploraClient,
    indexer::{UtxoCache, handlers, is_pre_lock_creation_tx},
};

#[tracing::instrument(
    skip(db, client, _cache),
    fields(block_run_id = %Uuid::new_v4(), height = %block_height)
)]
pub async fn process_block(
    db: &PgPool,
    client: &EsploraClient,
    _cache: &mut UtxoCache,
    block_height: u64,
) -> anyhow::Result<()> {
    let block_hash = client.get_block_hash_at_height(block_height).await?;
    let txids = client.get_block_txids(&block_hash).await?;
    let tx_count = txids.len();

    let mut tx = db.begin().await?;

    for txid in txids {
        let tx = client.get_tx_by_id(txid).await?;

        process_tx(db, &tx, block_height).await?;
    }

    sqlx::query!(
        r#"
        INSERT INTO sync_state (id, last_indexed_height, last_indexed_hash)
        VALUES (1, $1, $2)
        ON CONFLICT (id) DO UPDATE SET
            last_indexed_height = EXCLUDED.last_indexed_height,
            last_indexed_hash = EXCLUDED.last_indexed_hash,
            updated_at = NOW()
        "#,
        block_height as i64,
        block_hash,
    )
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    tracing::info!(
        "Successfully indexed block #{} ({} txs)",
        block_height,
        tx_count
    );

    Ok(())
}

pub async fn process_tx(db: &PgPool, tx: &Transaction, current_height: u64) -> anyhow::Result<()> {
    let txid = tx.txid();

    if let Some(args) = is_pre_lock_creation_tx(tx) {
        tracing::info!("Found pre lock transaction - {txid}");
        handlers::pre_lock::handle_pre_lock_creation(db, args, txid, current_height).await?;
    }

    Ok(())
}
