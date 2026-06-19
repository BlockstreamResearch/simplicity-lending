use std::sync::Arc;

use axum::{
    Json,
    extract::{Path, Query, State},
};
use uuid::Uuid;

use crate::api::openapi::{ErrorResponse, OfferDetailsResponseSchema, OfferListParams};
use crate::api::params::ScriptQuery;
use crate::api::utils::parse_script_pubkey;
use crate::api::{ApiError, AppState, OfferListQuery};

use super::dto::{OfferDetailsResponse, OfferListResponse, OffersOverview};

#[utoipa::path(
    get,
    path = "/offers/overview",
    tag = "offers",
    operation_id = "get_offers_overview",
    responses(
        (status = 200, description = "Protocol-wide active loan totals", body = OffersOverview),
        (status = 500, description = "Internal server error", body = ErrorResponse),
    )
)]
#[tracing::instrument(name = "Getting offers overview", skip(state))]
pub async fn get_overview(
    State(state): State<Arc<AppState>>,
) -> Result<Json<OffersOverview>, ApiError> {
    let overview = super::db::fetch_overview(&state.db).await?;

    Ok(Json(overview))
}

#[utoipa::path(
    get,
    path = "/offers",
    tag = "offers",
    params(OfferListParams),
    responses(
        (status = 200, description = "Paginated short offer list", body = OfferListResponse),
        (status = 400, description = "Invalid query parameters", body = ErrorResponse),
        (status = 500, description = "Internal server error", body = ErrorResponse),
    )
)]
#[tracing::instrument(name = "Getting offers list", skip(state, query))]
pub async fn list_offers(
    State(state): State<Arc<AppState>>,
    Query(query): Query<OfferListQuery>,
) -> Result<Json<OfferListResponse>, ApiError> {
    let offers = super::db::fetch_list(&state.db, query).await?;

    Ok(Json(offers))
}

#[utoipa::path(
    get,
    path = "/offers/{id}",
    tag = "offers",
    params(("id" = Uuid, Path, description = "Offer UUID")),
    responses(
        (status = 200, description = "Full offer details with participants and unspent UTXOs", body = OfferDetailsResponseSchema),
        (status = 404, description = "Offer not found", body = ErrorResponse),
        (status = 500, description = "Internal server error", body = ErrorResponse),
    )
)]
#[tracing::instrument(name = "Getting offer details", skip(state, offer_id))]
pub async fn get_details(
    State(state): State<Arc<AppState>>,
    Path(offer_id): Path<Uuid>,
) -> Result<Json<OfferDetailsResponse>, ApiError> {
    let details = super::db::fetch_details_by_id(&state.db, offer_id)
        .await?
        .ok_or_else(|| ApiError::NotFound(offer_id.to_string()))?;

    Ok(Json(details))
}

#[utoipa::path(
    get,
    path = "/offers/by-script",
    tag = "offers",
    params(ScriptQuery),
    responses(
        (status = 200, description = "Offer IDs with an unspent participant UTXO for the script", body = Vec<Uuid>),
        (status = 400, description = "Invalid script_pubkey hex", body = ErrorResponse),
        (status = 500, description = "Internal server error", body = ErrorResponse),
    )
)]
#[tracing::instrument(name = "Getting offer ids by script", skip(state, query))]
pub async fn get_ids_by_script(
    State(state): State<Arc<AppState>>,
    Query(query): Query<ScriptQuery>,
) -> Result<Json<Vec<Uuid>>, ApiError> {
    let script_bytes = parse_script_pubkey(&query.script_pubkey)?;

    let ids = super::db::fetch_ids_by_script(&state.db, &script_bytes).await?;

    Ok(Json(ids))
}
