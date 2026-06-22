use std::sync::Arc;

use axum::{
    Json,
    extract::{Query, State},
};

use crate::api::offers::dto::OfferListResponse;
use crate::api::openapi::{ErrorResponse, LenderOffersParams, LenderOverviewParams};
use crate::api::utils::parse_script_pubkey;
use crate::api::{ApiError, AppState};

use super::dto::LenderOverview;
use super::params::{LenderOffersQuery, LenderOverviewQuery};

#[utoipa::path(
    get,
    path = "/lenders/overview",
    tag = "lenders",
    operation_id = "get_lender_overview_by_script",
    params(LenderOverviewParams),
    responses(
        (status = 200, description = "Lender overview totals", body = LenderOverview),
        (status = 400, description = "Invalid script_pubkey hex", body = ErrorResponse),
        (status = 500, description = "Internal server error", body = ErrorResponse),
    )
)]
#[tracing::instrument(name = "Getting lender overview by script", skip(state, query))]
pub async fn get_overview_by_script(
    State(state): State<Arc<AppState>>,
    Query(query): Query<LenderOverviewQuery>,
) -> Result<Json<LenderOverview>, ApiError> {
    let script_bytes = parse_script_pubkey(&query.script_pubkey)?;

    let overview = super::db::fetch_overview(&state.db, &script_bytes).await?;

    Ok(Json(overview))
}

#[utoipa::path(
    get,
    path = "/lenders/offers",
    tag = "lenders",
    operation_id = "list_lender_offers_by_script",
    params(LenderOffersParams),
    responses(
        (status = 200, description = "Paginated short offer list for the lender", body = OfferListResponse),
        (status = 400, description = "Invalid query parameters", body = ErrorResponse),
        (status = 500, description = "Internal server error", body = ErrorResponse),
    )
)]
#[tracing::instrument(name = "Getting lender offers by script", skip(state, query))]
pub async fn list_offers_by_script(
    State(state): State<Arc<AppState>>,
    Query(query): Query<LenderOffersQuery>,
) -> Result<Json<OfferListResponse>, ApiError> {
    let script_bytes = parse_script_pubkey(&query.script_pubkey)?;

    let offers = super::db::fetch_offer_list(&state.db, &script_bytes, &query.filters).await?;

    Ok(Json(offers))
}
