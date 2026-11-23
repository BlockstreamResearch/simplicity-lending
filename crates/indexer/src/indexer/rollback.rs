use crate::{
    db::DbTx,
    events::{IndexerEvent, notify_indexer_event},
    indexer::upsert_sync_state,
    models::IndexedBlockModel,
};

#[derive(Debug, thiserror::Error)]
pub enum RollbackError {
    #[error("block #{height} is not the last indexed block (last: {last:?})")]
    NotLastBlock { height: u64, last: Option<u64> },
    #[error("block #{height} was indexed without undo data and cannot be rolled back")]
    NotRevertible { height: u64 },
    #[error("parent of block #{height} is not in the indexed block history")]
    MissingParent { height: u64 },
    #[error(transparent)]
    Db(#[from] sqlx::Error),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RolledBackBlock {
    pub hash: String,
    pub parent_hash: String,
}

/// Reverts everything the last indexed block `height` wrote and makes its parent the last
/// indexed block. Tracker caches are not touched and must be reloaded after the commit.
#[tracing::instrument(name = "Rolling back block", skip(sql_tx), fields(%height))]
pub async fn rollback_block(
    sql_tx: &mut DbTx<'_>,
    height: u64,
) -> Result<RolledBackBlock, RollbackError> {
    let (block, parent) = last_block_and_parent(sql_tx, height).await?;
    let h = height as i64;

    // Must run before the offers created in the block are deleted.
    sqlx::query!(
        r#"
        INSERT INTO offer_id_reservations (created_at_txid, offer_id)
        SELECT created_at_txid, id FROM offers WHERE created_at_height = $1
        ON CONFLICT DO NOTHING
        "#,
        h
    )
    .execute(&mut **sql_tx)
    .await?;

    // Deleting new rows before un-spending old ones keeps the partial unique indexes on
    // unspent factory and vault UTXOs satisfied.
    delete_rows_created_at(sql_tx, h).await?;
    restore_snapshots(sql_tx, h).await?;
    unmark_spent_at(sql_tx, h).await?;

    sqlx::query!(
        r#"
        WITH
            blocks AS (DELETE FROM indexed_blocks WHERE height = $1),
            offers AS (DELETE FROM offer_state_snapshots WHERE height = $1)
        DELETE FROM factory_state_snapshots WHERE height = $1
        "#,
        h
    )
    .execute(&mut **sql_tx)
    .await?;

    upsert_sync_state(sql_tx, parent.height as u64, parent.hash.clone()).await?;

    notify_indexer_event(
        sql_tx,
        &IndexerEvent::BlockReverted {
            height,
            hash: block.hash.clone(),
        },
    )
    .await?;

    tracing::info!(%height, hash = %block.hash, "Block rolled back");

    Ok(RolledBackBlock {
        hash: block.hash,
        parent_hash: parent.hash,
    })
}

async fn last_block_and_parent(
    sql_tx: &mut DbTx<'_>,
    height: u64,
) -> Result<(IndexedBlockModel, IndexedBlockModel), RollbackError> {
    let mut blocks = sqlx::query_as!(
        IndexedBlockModel,
        r#"
        SELECT height, hash, revertible
        FROM indexed_blocks
        ORDER BY height DESC
        LIMIT 2
        "#
    )
    .fetch_all(&mut **sql_tx)
    .await?
    .into_iter();

    let block = match blocks.next() {
        Some(block) if block.height == height as i64 => block,
        last => {
            return Err(RollbackError::NotLastBlock {
                height,
                last: last.map(|block| block.height as u64),
            });
        }
    };

    if !block.revertible {
        return Err(RollbackError::NotRevertible { height });
    }

    let parent = blocks
        .next()
        .filter(|parent| parent.height == block.height - 1)
        .ok_or(RollbackError::MissingParent { height })?;

    Ok((block, parent))
}

/// Deletes children before parents, so nothing relies on `ON DELETE CASCADE`.
async fn delete_rows_created_at(sql_tx: &mut DbTx<'_>, height: i64) -> Result<(), sqlx::Error> {
    sqlx::query!(
        "DELETE FROM offer_vault_withdrawals WHERE height = $1",
        height
    )
    .execute(&mut **sql_tx)
    .await?;
    sqlx::query!("DELETE FROM offer_repayments WHERE height = $1", height)
        .execute(&mut **sql_tx)
        .await?;
    sqlx::query!(
        "DELETE FROM offer_vaults WHERE created_at_height = $1",
        height
    )
    .execute(&mut **sql_tx)
    .await?;
    sqlx::query!(
        "DELETE FROM offer_participants WHERE created_at_height = $1",
        height
    )
    .execute(&mut **sql_tx)
    .await?;
    sqlx::query!(
        "DELETE FROM offer_utxos WHERE created_at_height = $1",
        height
    )
    .execute(&mut **sql_tx)
    .await?;
    sqlx::query!("DELETE FROM offers WHERE created_at_height = $1", height)
        .execute(&mut **sql_tx)
        .await?;
    sqlx::query!(
        "DELETE FROM factory_auths WHERE created_at_height = $1",
        height
    )
    .execute(&mut **sql_tx)
    .await?;
    sqlx::query!(
        "DELETE FROM factory_utxos WHERE created_at_height = $1",
        height
    )
    .execute(&mut **sql_tx)
    .await?;
    sqlx::query!("DELETE FROM factories WHERE created_at_height = $1", height)
        .execute(&mut **sql_tx)
        .await?;

    Ok(())
}

async fn restore_snapshots(sql_tx: &mut DbTx<'_>, height: i64) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"
        UPDATE offers
        SET current_status = snapshot.current_status,
            current_debt = snapshot.current_debt,
            collateral_remaining = snapshot.collateral_remaining,
            updated_at_height = snapshot.updated_at_height
        FROM offer_state_snapshots snapshot
        WHERE snapshot.height = $1 AND snapshot.offer_id = offers.id
        "#,
        height
    )
    .execute(&mut **sql_tx)
    .await?;

    sqlx::query!(
        r#"
        UPDATE factories
        SET current_status = snapshot.current_status
        FROM factory_state_snapshots snapshot
        WHERE snapshot.height = $1 AND snapshot.factory_id = factories.id
        "#,
        height
    )
    .execute(&mut **sql_tx)
    .await?;

    Ok(())
}

async fn unmark_spent_at(sql_tx: &mut DbTx<'_>, height: i64) -> Result<(), sqlx::Error> {
    sqlx::query!(
        "UPDATE offer_utxos SET spent_txid = NULL, spent_at_height = NULL WHERE spent_at_height = $1",
        height
    )
    .execute(&mut **sql_tx)
    .await?;
    sqlx::query!(
        "UPDATE offer_participants SET spent_txid = NULL, spent_at_height = NULL WHERE spent_at_height = $1",
        height
    )
    .execute(&mut **sql_tx)
    .await?;
    sqlx::query!(
        "UPDATE offer_vaults SET spent_txid = NULL, spent_at_height = NULL WHERE spent_at_height = $1",
        height
    )
    .execute(&mut **sql_tx)
    .await?;
    sqlx::query!(
        "UPDATE factory_utxos SET spent_txid = NULL, spent_at_height = NULL WHERE spent_at_height = $1",
        height
    )
    .execute(&mut **sql_tx)
    .await?;
    sqlx::query!(
        "UPDATE factory_auths SET spent_txid = NULL, spent_at_height = NULL WHERE spent_at_height = $1",
        height
    )
    .execute(&mut **sql_tx)
    .await?;

    Ok(())
}
