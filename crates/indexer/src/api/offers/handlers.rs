use std::sync::Arc;

use axum::{
    Json,
    extract::{Path, Query, State},
};
use uuid::Uuid;

use crate::api::params::ScriptQuery;
use crate::api::{ApiError, AppState, OfferListQuery};

use super::dto::{OfferDetailsResponse, OfferListResponse};

#[tracing::instrument(name = "Getting offers list", skip(state, query))]
pub async fn list_offers(
    State(state): State<Arc<AppState>>,
    Query(query): Query<OfferListQuery>,
) -> Result<Json<OfferListResponse>, ApiError> {
    let offers = super::db::fetch_list(&state.db, query).await?;

    Ok(Json(offers))
}

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

#[tracing::instrument(name = "Getting offer ids by script", skip(state, query))]
pub async fn get_ids_by_script(
    State(state): State<Arc<AppState>>,
    Query(query): Query<ScriptQuery>,
) -> Result<Json<Vec<Uuid>>, ApiError> {
    let script_bytes = hex::decode(&query.script_pubkey)
        .map_err(|_| ApiError::BadRequest("Invalid script_pubkey hex".to_string()))?;

    let ids = super::db::fetch_ids_by_script(&state.db, &script_bytes).await?;

    Ok(Json(ids))
}
