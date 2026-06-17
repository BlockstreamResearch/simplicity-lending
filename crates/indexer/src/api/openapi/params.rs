//! OpenAPI-only query parameter types (flat layout for Swagger UI).
#![allow(dead_code)]

use utoipa::IntoParams;
use uuid::Uuid;

use crate::api::params::{OfferSortBy, SortDir};

/// OpenAPI query parameters for `GET /offers` (flat query string).
#[derive(IntoParams)]
#[into_params(parameter_in = Query)]
pub struct OfferListParams {
    /// Comma-separated offer states, e.g. `pending,active`.
    #[param(example = "pending,active")]
    pub status: Option<String>,
    /// Collateral asset hex (same byte order as API responses).
    pub collateral_asset: Option<String>,
    /// Principal asset hex (same byte order as API responses).
    pub principal_asset: Option<String>,
    pub factory_id: Option<Uuid>,
    /// Maximum records to return (default 50, max 100).
    #[param(minimum = 0, maximum = 100, example = 50)]
    pub limit: Option<u64>,
    #[param(minimum = 0, example = 0)]
    pub offset: Option<u64>,
    pub sort_by: Option<OfferSortBy>,
    pub sort_dir: Option<SortDir>,
}

/// OpenAPI query parameters for `GET /borrowers/by-script` (flat query string).
#[derive(IntoParams)]
#[into_params(parameter_in = Query)]
pub struct BorrowerDashboardParams {
    /// Wallet script pubkey hex.
    #[param(example = "00144f883a4bb668547b534ae815bc32628893b6f435")]
    pub script_pubkey: String,
    /// Comma-separated offer states, e.g. `pending,active`.
    #[param(example = "pending,active")]
    pub status: Option<String>,
    pub collateral_asset: Option<String>,
    pub principal_asset: Option<String>,
    pub factory_id: Option<Uuid>,
    #[param(minimum = 0, maximum = 100, example = 50)]
    pub limit: Option<u64>,
    #[param(minimum = 0, example = 0)]
    pub offset: Option<u64>,
    pub sort_by: Option<OfferSortBy>,
    pub sort_dir: Option<SortDir>,
}
