use std::sync::Arc;

use axum::{
    Json,
    extract::{Path, Query, State},
};
use uuid::Uuid;

use crate::api::params::ScriptQuery;
use crate::api::{ApiError, AppState, OfferListQuery};

use super::dto::{
    BatchIdsRequest, OfferDetailsResponse, OfferListItemFull, OfferListResponse, OfferUtxoDto,
    ParticipantDto,
};

#[tracing::instrument(name = "Getting offers list", skip(state, query))]
pub async fn list_offers(
    State(state): State<Arc<AppState>>,
    Query(query): Query<OfferListQuery>,
) -> Result<Json<OfferListResponse>, ApiError> {
    let offers = super::db::fetch_list(&state.db, query).await?;

    Ok(Json(offers))
}

#[tracing::instrument(name = "Getting offers full info", skip(state, query))]
pub async fn get_full_info(
    State(state): State<Arc<AppState>>,
    Query(query): Query<OfferListQuery>,
) -> Result<Json<Vec<OfferListItemFull>>, ApiError> {
    let offers = super::db::fetch_full_info_filtered(&state.db, query).await?;

    Ok(Json(offers))
}

#[tracing::instrument(name = "Getting offer details", skip(state, offer_id))]
pub async fn get_details(
    State(state): State<Arc<AppState>>,
    Path(offer_id): Path<Uuid>,
) -> Result<Json<OfferDetailsResponse>, ApiError> {
    let offer_info = super::db::fetch_full_info_by_id(&state.db, offer_id)
        .await?
        .ok_or_else(|| ApiError::NotFound(offer_id.to_string()))?;

    let participants = super::db::fetch_latest_participants(&state.db, offer_id).await?;

    Ok(Json(OfferDetailsResponse {
        info: offer_info,
        participants,
    }))
}

#[tracing::instrument(
    name = "Getting offer details by ids",
    skip(state, payload),
    fields(
        request_ids_count = %payload.ids.len()
    )
)]
pub async fn get_details_batch(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<BatchIdsRequest>,
) -> Result<Json<Vec<OfferDetailsResponse>>, ApiError> {
    let result = super::db::fetch_details_by_ids(&state.db, &payload.ids).await?;
    Ok(Json(result))
}

#[tracing::instrument(
    name = "Getting offer participants movement history",
    skip(state, offer_id)
)]
pub async fn get_participants_history(
    State(state): State<Arc<AppState>>,
    Path(offer_id): Path<Uuid>,
) -> Result<Json<Vec<ParticipantDto>>, ApiError> {
    let participants_history = super::db::fetch_participants_history(&state.db, offer_id).await?;

    if participants_history.is_empty() {
        return Err(ApiError::NotFound(offer_id.to_string()));
    }

    Ok(Json(participants_history))
}

#[tracing::instrument(name = "Getting latest offer participants", skip(state, offer_id))]
pub async fn get_latest_participants(
    State(state): State<Arc<AppState>>,
    Path(offer_id): Path<Uuid>,
) -> Result<Json<Vec<ParticipantDto>>, ApiError> {
    let latest_participants = super::db::fetch_latest_participants(&state.db, offer_id).await?;

    if latest_participants.is_empty() {
        return Err(ApiError::NotFound(offer_id.to_string()));
    }

    Ok(Json(latest_participants))
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

#[tracing::instrument(name = "Getting offer utxos history", skip(state, offer_id))]
pub async fn get_utxos_history(
    State(state): State<Arc<AppState>>,
    Path(offer_id): Path<Uuid>,
) -> Result<Json<Vec<OfferUtxoDto>>, ApiError> {
    let utxos_history = super::db::fetch_utxos_history(&state.db, offer_id).await?;

    if utxos_history.is_empty() {
        return Err(ApiError::NotFound(offer_id.to_string()));
    }

    Ok(Json(utxos_history))
}
