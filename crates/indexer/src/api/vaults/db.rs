use sqlx::PgPool;

use crate::api::utils::{format_hex, format_offer_id, format_satoshis};

use super::dto::{ProtocolFeeVaultDto, ProtocolFeeVaultsResponse};

struct HarvestableProtocolFeeVaultRow {
    offer_id: i64,
    txid: Vec<u8>,
    vout: i32,
    amount: i64,
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
            borrower_nft_asset: format_hex(row.borrower_nft_asset_id),
            protocol_fee_keeper_asset: format_hex(row.protocol_fee_keeper_asset_id),
            created_at_height: row.created_at_height as u64,
            updated_at_height: row.updated_at_height as u64,
        }
    }
}

#[tracing::instrument(name = "Fetching unspent protocol-fee vaults", skip(db))]
pub async fn fetch_unspent_protocol_fee_vaults(
    db: &PgPool,
    principal_asset_id: Vec<u8>,
) -> Result<ProtocolFeeVaultsResponse, sqlx::Error> {
    let rows = sqlx::query_as!(
        HarvestableProtocolFeeVaultRow,
        r#"
        SELECT
            offer_vaults.offer_id,
            offer_vaults.txid,
            offer_vaults.vout,
            offer_vaults.amount,
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
        "#,
        principal_asset_id,
    )
    .fetch_all(db)
    .await?;

    let count = rows.len() as u64;
    let total_amount: i64 = rows.iter().map(|row| row.amount).sum();
    let items = rows.into_iter().map(ProtocolFeeVaultDto::from).collect();

    Ok(ProtocolFeeVaultsResponse {
        items,
        count,
        total_amount: format_satoshis(total_amount),
    })
}
