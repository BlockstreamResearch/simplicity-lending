use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::api::dto::AssetAmount;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct BorrowerOverview {
    pub collateral_locked: Vec<AssetAmount>,
    pub borrowings: Vec<AssetAmount>,
    pub active_loans: u64,
    pub pending_offers: u64,
}
