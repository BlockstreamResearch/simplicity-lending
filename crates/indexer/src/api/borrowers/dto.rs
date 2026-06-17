use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::api::OfferListQuery;
use crate::api::offers::dto::OfferListResponse;

#[derive(Deserialize)]
pub struct BorrowerDashboardQuery {
    pub script_pubkey: String,
    #[serde(flatten)]
    pub filters: OfferListQuery,
}

#[derive(Serialize, ToSchema)]
pub struct AssetAmount {
    pub asset: String,
    /// Amount in satoshis (decimal string).
    #[schema(example = "1000")]
    pub amount: String,
}

#[derive(Serialize, ToSchema)]
pub struct BorrowerOverview {
    pub collateral_locked: Vec<AssetAmount>,
    pub borrowings: Vec<AssetAmount>,
    pub active_loans: u64,
    pub pending_offers: u64,
}

#[derive(Serialize, ToSchema)]
pub struct BorrowerDashboardResponse {
    pub overview: BorrowerOverview,
    pub offers: OfferListResponse,
}
