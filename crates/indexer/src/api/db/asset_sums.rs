use crate::api::dto::AssetAmount;
use crate::api::utils::{format_hex, format_satoshis};

#[derive(sqlx::FromRow)]
pub(crate) struct AssetSumRow {
    pub asset_id: Vec<u8>,
    pub amount: i64,
}

pub(crate) fn asset_amounts_from_rows(rows: Vec<AssetSumRow>) -> Vec<AssetAmount> {
    rows.into_iter()
        .map(|row| AssetAmount {
            asset: format_hex(row.asset_id),
            amount: format_satoshis(row.amount),
        })
        .collect()
}
