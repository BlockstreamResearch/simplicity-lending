use serde::Serialize;
use utoipa::ToSchema;

use crate::api::dto::AssetAmount;

#[derive(Serialize, ToSchema)]
pub struct BorrowerOverview {
    pub collateral_locked: Vec<AssetAmount>,
    pub borrowings: Vec<AssetAmount>,
    pub active_loans: u64,
    pub pending_offers: u64,
}
