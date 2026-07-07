use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::api::dto::AssetAmount;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct LenderOverview {
    pub supplied_loans: Vec<AssetAmount>,
    pub interest_outstanding: Vec<AssetAmount>,
    pub active_loans: u64,
    pub to_be_claimed: u64,
}
