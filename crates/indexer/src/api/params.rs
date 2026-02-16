use serde::Deserialize;

use crate::models::OfferStatus;

#[derive(Deserialize)]
pub struct Pagination {
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

#[derive(serde::Deserialize, Debug, Default)]
pub struct OfferFilters {
    pub status: Option<OfferStatus>,
    pub asset: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}
