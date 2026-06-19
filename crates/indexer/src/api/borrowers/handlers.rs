use std::sync::Arc;

use axum::{
    Json,
    extract::{Query, State},
};

use crate::api::offers::dto::OfferListResponse;
use crate::api::openapi::{BorrowerOffersParams, BorrowerOverviewParams, ErrorResponse};
use crate::api::utils::parse_script_pubkey;
use crate::api::{ApiError, AppState};

use super::dto::BorrowerOverview;
use super::params::{BorrowerOffersQuery, BorrowerOverviewQuery};

#[utoipa::path(
    get,
    path = "/borrowers/overview",
    tag = "borrowers",
    params(BorrowerOverviewParams),
    responses(
        (status = 200, description = "Borrower overview totals", body = BorrowerOverview),
        (status = 400, description = "Invalid script_pubkey hex", body = ErrorResponse),
        (status = 500, description = "Internal server error", body = ErrorResponse),
    )
)]
#[tracing::instrument(name = "Getting borrower overview by script", skip(state, query))]
pub async fn get_overview_by_script(
    State(state): State<Arc<AppState>>,
    Query(query): Query<BorrowerOverviewQuery>,
) -> Result<Json<BorrowerOverview>, ApiError> {
    let script_bytes = parse_script_pubkey(&query.script_pubkey)?;

    let overview = super::db::fetch_overview(&state.db, &script_bytes).await?;

    Ok(Json(overview))
}

#[utoipa::path(
    get,
    path = "/borrowers/offers",
    tag = "borrowers",
    params(BorrowerOffersParams),
    responses(
        (status = 200, description = "Paginated short offer list for the borrower", body = OfferListResponse),
        (status = 400, description = "Invalid query parameters", body = ErrorResponse),
        (status = 500, description = "Internal server error", body = ErrorResponse),
    )
)]
#[tracing::instrument(name = "Getting borrower offers by script", skip(state, query))]
pub async fn list_offers_by_script(
    State(state): State<Arc<AppState>>,
    Query(query): Query<BorrowerOffersQuery>,
) -> Result<Json<OfferListResponse>, ApiError> {
    let script_bytes = parse_script_pubkey(&query.script_pubkey)?;

    let offers = super::db::fetch_offer_list(&state.db, &script_bytes, &query.filters).await?;

    Ok(Json(offers))
}
