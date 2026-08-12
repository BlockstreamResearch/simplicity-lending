use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::api::dto::AssetAmount;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct BorrowerOverview {
    /// Remaining locked collateral for pending + active offers.
    pub collateral_locked: Vec<AssetAmount>,
    /// Outstanding debt (`current_debt`) for pending + active offers.
    pub borrowings: Vec<AssetAmount>,
    pub active_loans: u64,
    pub pending_offers: u64,
}
