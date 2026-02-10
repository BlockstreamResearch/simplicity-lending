use sqlx::PgPool;

use simplicityhl::elements::{Transaction, hex::ToHex};

use uuid::Uuid;

use crate::{
    db::DbTx,
    esplora_client::EsploraClient,
    indexer::{UtxoCache, db, handlers, is_pre_lock_creation_tx},
};

#[tracing::instrument(
    name = "Processing block",
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

    let mut sql_tx = db.begin().await?;

    for txid in txids {
        let tx = client.get_tx_by_id(txid).await?;

        process_tx(&mut sql_tx, &tx, block_height).await?;
    }

    db::upsert_sync_state(&mut sql_tx, block_height, block_hash).await?;

    sql_tx.commit().await?;

    tracing::info!(
        "Successfully indexed block #{} ({} txs)",
        block_height,
        tx_count
    );

    Ok(())
}

#[tracing::instrument(
    name = "Processing transaction",
    skip(sql_tx, tx, block_height),
    fields(txid = %tx.txid().to_hex())
)]
pub async fn process_tx(
    sql_tx: &mut DbTx<'_>,
    tx: &Transaction,
    block_height: u64,
) -> anyhow::Result<()> {
    let txid = tx.txid();

    if let Some(args) = is_pre_lock_creation_tx(tx) {
        tracing::info!("Found pre lock transaction - {txid}");
        handlers::pre_lock::handle_pre_lock_creation(sql_tx, args, txid, block_height).await?;
    }

    Ok(())
}
