use lending_indexer::db::DbTx;
use lending_indexer::indexer::{
    RollbackError, RolledBackBlock, TrackerRegistry, record_indexed_block, rollback_block,
    upsert_sync_state,
};
use simplex::simplicityhl::elements::Transaction;
use sqlx::PgPool;

/// Indexer tables: name, columns a dump is ordered by, and the identity column whose values
/// follow insertion order rather than the chain.
const DUMPED_TABLES: &[(&str, &str, Option<&str>)] = &[
    ("factories", "id", None),
    ("factory_utxos", "txid, vout", None),
    ("factory_auths", "txid, vout", None),
    ("offers", "id", None),
    ("offer_utxos", "txid, vout", None),
    ("offer_participants", "txid, vout", Some("id")),
    ("offer_repayments", "txid", Some("id")),
    ("offer_vaults", "txid, vout", Some("id")),
    (
        "offer_vault_withdrawals",
        "offer_id, txid, vault_type",
        Some("id"),
    ),
    ("offer_state_snapshots", "height, offer_id", None),
    ("factory_state_snapshots", "height, factory_id", None),
    ("indexed_blocks", "height", None),
    ("sync_state", "id", None),
];

pub fn block_hash(height: u64) -> String {
    format!("hash-{height}")
}

/// Every row of the indexer tables, except `sync_state.updated_at` (a wall-clock time)
/// and `offer_id_reservations` (kept after a rollback on purpose).
pub async fn dump_indexer_state(pool: &PgPool) -> anyhow::Result<serde_json::Value> {
    dump(pool, false).await
}

/// [`dump_indexer_state`] without the identity ids that change when the same rows are
/// inserted again, e.g. by re-indexing a block. `offers.id` is kept.
pub async fn dump_chain_state(pool: &PgPool) -> anyhow::Result<serde_json::Value> {
    dump(pool, true).await
}

async fn dump(pool: &PgPool, skip_identity_ids: bool) -> anyhow::Result<serde_json::Value> {
    let mut state = serde_json::Map::new();

    for (table, order_by, identity_id) in DUMPED_TABLES {
        let skipped = match identity_id {
            Some(column) if skip_identity_ids => format!(" - '{column}'"),
            _ => String::new(),
        };
        let rows: String = sqlx::query_scalar(&format!(
            "SELECT COALESCE(jsonb_agg(to_jsonb(t) - 'updated_at'{skipped} ORDER BY {order_by}), '[]')::text \
             FROM {table} t"
        ))
        .fetch_one(pool)
        .await?;

        state.insert((*table).to_string(), serde_json::from_str(&rows)?);
    }

    Ok(serde_json::Value::Object(state))
}

/// Records block `height` the way `BlockProcessor` does after processing its transactions.
pub async fn finish_block(sql_tx: &mut DbTx<'_>, height: u64) -> anyhow::Result<()> {
    record_indexed_block(sql_tx, height, &block_hash(height)).await?;
    upsert_sync_state(sql_tx, height, block_hash(height)).await?;

    Ok(())
}

/// Indexes `txs` as block `height` in one SQL transaction, as `BlockProcessor` does.
pub async fn index_block(
    pool: &PgPool,
    registry: &mut TrackerRegistry,
    height: u64,
    txs: &[Transaction],
) -> anyhow::Result<()> {
    let mut sql_tx = pool.begin().await?;
    registry.begin_block();

    for tx in txs {
        registry.process_tx(&mut sql_tx, tx, height).await?;
    }
    finish_block(&mut sql_tx, height).await?;

    sql_tx.commit().await?;
    registry.commit_block();

    Ok(())
}

pub async fn rollback(pool: &PgPool, height: u64) -> Result<RolledBackBlock, RollbackError> {
    let mut sql_tx = pool.begin().await?;
    let rolled_back = rollback_block(&mut sql_tx, height).await?;
    sql_tx.commit().await?;

    Ok(rolled_back)
}

/// Rolls back block `height` and checks the DB is exactly as it was before the block.
pub async fn assert_rollback_restores(
    pool: &PgPool,
    height: u64,
    before: &serde_json::Value,
) -> anyhow::Result<()> {
    assert_ne!(
        &dump_indexer_state(pool).await?,
        before,
        "block #{height} changed nothing"
    );

    rollback(pool, height).await?;

    assert_eq!(&dump_indexer_state(pool).await?, before);

    Ok(())
}

/// Indexes `txs` as block `height` on top of the current state, rolls it back and checks
/// the DB is exactly as it was before the block.
pub async fn assert_block_rolls_back(
    pool: &PgPool,
    registry: &mut TrackerRegistry,
    height: u64,
    txs: &[Transaction],
) -> anyhow::Result<()> {
    let before = dump_indexer_state(pool).await?;

    index_block(pool, registry, height, txs).await?;

    assert_rollback_restores(pool, height, &before).await
}
