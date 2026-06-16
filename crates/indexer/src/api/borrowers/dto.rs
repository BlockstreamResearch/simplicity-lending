use serde::{Deserialize, Serialize};

use crate::api::OfferListQuery;
use crate::api::offers::dto::OfferListResponse;

#[derive(Deserialize)]
pub struct BorrowerDashboardQuery {
    pub script_pubkey: String,
    #[serde(flatten)]
    pub filters: OfferListQuery,
}

#[derive(Serialize)]
pub struct AssetAmount {
    pub asset: String,
    pub amount: String,
}

#[derive(Serialize)]
pub struct BorrowerOverview {
    pub collateral_locked: Vec<AssetAmount>,
    pub borrowings: Vec<AssetAmount>,
    pub active_loans: u64,
    pub pending_offers: u64,
}

#[derive(Serialize)]
pub struct BorrowerDashboardResponse {
    pub overview: BorrowerOverview,
    pub offers: OfferListResponse,
}
