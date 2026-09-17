use sqlx::PgPool;

use crate::api::utils::{format_hex, format_offer_id, format_satoshis};

use super::dto::{ProtocolFeeVaultDto, ProtocolFeeVaultsQuery, ProtocolFeeVaultsResponse};

struct HarvestableProtocolFeeVaultRow {
    offer_id: i64,
    txid: Vec<u8>,
    vout: i32,
    amount: i64,
    already_supplied: i64,
    created_at_height: i64,
    updated_at_height: i64,
    borrower_nft_asset_id: Vec<u8>,
    protocol_fee_keeper_asset_id: Vec<u8>,
}

impl From<HarvestableProtocolFeeVaultRow> for ProtocolFeeVaultDto {
    fn from(row: HarvestableProtocolFeeVaultRow) -> Self {
        Self {
            offer_id: format_offer_id(row.offer_id),
            txid: format_hex(row.txid),
            vout: row.vout as u32,
            amount: format_satoshis(row.amount),
            supply_goal: format_satoshis(row.already_supplied),
            borrower_nft_asset: format_hex(row.borrower_nft_asset_id),
            protocol_fee_keeper_asset: format_hex(row.protocol_fee_keeper_asset_id),
            created_at_height: row.created_at_height as u64,
            updated_at_height: row.updated_at_height as u64,
        }
    }
}

struct HarvestableProtocolFeeVaultsTotals {
    total_count: i64,
    total_amount: i64,
}

#[tracing::instrument(
    name = "Fetching unspent protocol-fee vaults totals",
    skip(db, principal_asset_id)
)]
async fn fetch_unspent_protocol_fee_vaults_totals(
    db: &PgPool,
    principal_asset_id: &[u8],
) -> Result<HarvestableProtocolFeeVaultsTotals, sqlx::Error> {
    sqlx::query_as!(
        HarvestableProtocolFeeVaultsTotals,
        r#"
        SELECT
            COUNT(*)::BIGINT AS "total_count!",
            COALESCE(SUM(offer_vaults.amount), 0)::BIGINT AS "total_amount!"
        FROM offer_vaults
        JOIN offers ON offers.id = offer_vaults.offer_id
        WHERE offer_vaults.vault_type = 'protocol_fee'
          AND offer_vaults.is_finalized = true
          AND offer_vaults.spent_txid IS NULL
          AND offers.principal_asset_id = $1
        "#,
        principal_asset_id,
    )
    .fetch_one(db)
    .await
}

#[tracing::instrument(
    name = "Fetching unspent protocol-fee vaults page",
    skip(db, principal_asset_id)
)]
async fn fetch_unspent_protocol_fee_vaults_page(
    db: &PgPool,
    principal_asset_id: &[u8],
    limit: i64,
    offset: i64,
) -> Result<Vec<HarvestableProtocolFeeVaultRow>, sqlx::Error> {
    sqlx::query_as!(
        HarvestableProtocolFeeVaultRow,
        r#"
        SELECT
            offer_vaults.offer_id,
            offer_vaults.txid,
            offer_vaults.vout,
            offer_vaults.amount,
            offer_vaults.already_supplied,
            offer_vaults.created_at_height,
            offer_vaults.updated_at_height,
            offers.borrower_nft_asset_id,
            offers.protocol_fee_keeper_asset_id
        FROM offer_vaults
        JOIN offers ON offers.id = offer_vaults.offer_id
        WHERE offer_vaults.vault_type = 'protocol_fee'
          AND offer_vaults.is_finalized = true
          AND offer_vaults.spent_txid IS NULL
          AND offers.principal_asset_id = $1
        ORDER BY offer_vaults.amount DESC, offer_vaults.id DESC
        LIMIT $2
        OFFSET $3
        "#,
        principal_asset_id,
        limit,
        offset,
    )
    .fetch_all(db)
    .await
}

#[tracing::instrument(
    name = "Fetching unspent protocol-fee vaults",
    skip(db, query),
    fields(limit = %query.effective_limit(), offset = %query.effective_offset())
)]
pub async fn fetch_unspent_protocol_fee_vaults(
    db: &PgPool,
    principal_asset_id: Vec<u8>,
    query: &ProtocolFeeVaultsQuery,
) -> Result<ProtocolFeeVaultsResponse, sqlx::Error> {
    let limit = query.effective_limit();
    let offset = query.effective_offset();

    let (totals, rows) = tokio::try_join!(
        fetch_unspent_protocol_fee_vaults_totals(db, &principal_asset_id),
        fetch_unspent_protocol_fee_vaults_page(
            db,
            &principal_asset_id,
            limit as i64,
            offset as i64
        ),
    )?;

    let items = rows.into_iter().map(ProtocolFeeVaultDto::from).collect();

    Ok(ProtocolFeeVaultsResponse {
        items,
        total_count: totals.total_count as u64,
        limit,
        offset,
        total_amount: format_satoshis(totals.total_amount),
    })
}
