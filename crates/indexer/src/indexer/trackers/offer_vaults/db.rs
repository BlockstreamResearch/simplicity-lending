use simplex::simplicityhl::elements::{OutPoint, Txid, hashes::Hash, hex::ToHex};

use crate::{
    api::utils::{format_hex, format_offer_id, format_satoshis},
    db::DbTx,
    events::{IndexerEvent, notify_indexer_event},
    indexer::{VaultWatchEntry, WatchCache},
    models::{OfferVaultModel, OfferVaultWithdrawalModel, VaultType},
};

#[tracing::instrument(
    name = "Inserting offer vault into DB",
    skip(sql_tx, vault),
    fields(
        offer_id = %vault.offer_id,
        vault_type = ?vault.vault_type,
        amount = %vault.amount,
        already_supplied = %vault.already_supplied,
        is_finalized = %vault.is_finalized
    )
)]
pub async fn insert_offer_vault(
    sql_tx: &mut DbTx<'_>,
    vault: &OfferVaultModel,
) -> Result<i64, sqlx::Error> {
    let row = sqlx::query!(
        r#"
        INSERT INTO offer_vaults (
            offer_id, vault_type, txid, vout, amount, already_supplied, is_finalized,
            created_at_height, updated_at_height, spent_txid, spent_at_height
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING id
        "#,
        vault.offer_id,
        vault.vault_type as VaultType,
        vault.txid,
        vault.vout,
        vault.amount,
        vault.already_supplied,
        vault.is_finalized,
        vault.created_at_height,
        vault.updated_at_height,
        vault.spent_txid,
        vault.spent_at_height,
    )
    .fetch_one(&mut **sql_tx)
    .await
    .map_err(|e| {
        tracing::error!("Failed to insert offer vault: {e:?}");
        e
    })?;

    Ok(row.id)
}

#[tracing::instrument(
    name = "Marking offer vault as spent in DB",
    skip(sql_tx, outpoint, block_height, txid),
    fields(
        spent_txid = %txid.to_hex(),
        txid = %outpoint.txid.to_hex(),
        vout = %outpoint.vout
    )
)]
pub async fn spend_offer_vault(
    sql_tx: &mut DbTx<'_>,
    outpoint: &OutPoint,
    block_height: u64,
    txid: Txid,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"
        UPDATE offer_vaults
        SET spent_txid = $1, spent_at_height = $2
        WHERE txid = $3 AND vout = $4
        "#,
        txid.as_byte_array(),
        block_height as i64,
        outpoint.txid.as_byte_array(),
        outpoint.vout as i32,
    )
    .execute(&mut **sql_tx)
    .await
    .map_err(|e| {
        tracing::error!("Failed to mark offer vault as spent: {e:?}");
        e
    })?;

    Ok(())
}

#[tracing::instrument(name = "Loading all active offer vaults from DB", skip(db))]
pub async fn load_offer_vaults_cache(
    db: &sqlx::PgPool,
) -> anyhow::Result<WatchCache<VaultWatchEntry>> {
    let rows = sqlx::query_as!(
        OfferVaultModel,
        r#"
        SELECT
            id,
            offer_id,
            vault_type AS "vault_type: VaultType",
            txid,
            vout,
            amount,
            already_supplied,
            is_finalized,
            created_at_height,
            updated_at_height,
            spent_txid,
            spent_at_height
        FROM offer_vaults
        WHERE spent_txid IS NULL
        "#
    )
    .fetch_all(db)
    .await
    .map_err(|e| {
        tracing::error!("Failed to load active offer vaults from DB: {e:?}");
        e
    })?;

    let count = rows.len();
    let mut cache = WatchCache::with_capacity(count);

    for row in rows {
        let outpoint = OutPoint {
            txid: Txid::from_slice(&row.txid)?,
            vout: row.vout as u32,
        };
        cache.insert(
            outpoint,
            VaultWatchEntry {
                offer_id: row.offer_id,
                vault_type: row.vault_type,
                amount: row.amount as u64,
                already_supplied: row.already_supplied as u64,
                is_finalized: row.is_finalized,
            },
        );
    }

    tracing::info!(vaults = count, "Warm-up: Vaults WatchCache populated");

    Ok(cache)
}

#[tracing::instrument(
    name = "Inserting offer vault withdrawal history row",
    skip(sql_tx, withdrawal),
    fields(
        offer_id = %withdrawal.offer_id,
        vault_type = ?withdrawal.vault_type,
        height = %withdrawal.height,
        is_full = %withdrawal.is_full,
        amount_withdrawn = %withdrawal.amount_withdrawn
    )
)]
pub async fn insert_offer_vault_withdrawal(
    sql_tx: &mut DbTx<'_>,
    withdrawal: &OfferVaultWithdrawalModel,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"
        INSERT INTO offer_vault_withdrawals (
            offer_id, vault_type, txid, height, is_full,
            amount_withdrawn, vault_amount_before, vault_amount_after
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        "#,
        withdrawal.offer_id,
        withdrawal.vault_type as VaultType,
        withdrawal.txid,
        withdrawal.height,
        withdrawal.is_full,
        withdrawal.amount_withdrawn,
        withdrawal.vault_amount_before,
        withdrawal.vault_amount_after,
    )
    .execute(&mut **sql_tx)
    .await
    .map_err(|e| {
        tracing::error!("Failed to insert offer vault withdrawal: {e:?}");
        e
    })?;

    notify_indexer_event(
        sql_tx,
        &IndexerEvent::OfferVaultWithdrawalIndexed {
            id: format_offer_id(withdrawal.offer_id),
            txid: format_hex(withdrawal.txid.clone()),
            height: withdrawal.height as u64,
            vault_type: withdrawal.vault_type,
            is_full: withdrawal.is_full,
            amount_withdrawn: format_satoshis(withdrawal.amount_withdrawn),
        },
    )
    .await?;

    Ok(())
}
