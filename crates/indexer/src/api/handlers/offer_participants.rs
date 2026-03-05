use std::sync::Arc;

use axum::{
    Json,
    extract::{Path, Query, State},
};
use uuid::Uuid;

use crate::api::dto::{ParticipantDto, ScriptQuery};
use crate::api::{ApiError, AppState, db};

#[tracing::instrument(
    name = "Getting offer participants movement history",
    skip(state, offer_id)
)]
pub async fn get_offer_participants_history(
    State(state): State<Arc<AppState>>,
    Path(offer_id): Path<Uuid>,
) -> Result<Json<Vec<ParticipantDto>>, ApiError> {
    let participants_history = db::fetch_offer_participants_history(&state.db, offer_id).await?;

    if participants_history.is_empty() {
        return Err(ApiError::NotFound(offer_id.to_string()));
    }

    Ok(Json(participants_history))
}

#[tracing::instrument(name = "Getting latest offer participants", skip(state, offer_id))]
pub async fn get_latest_offer_participants(
    State(state): State<Arc<AppState>>,
    Path(offer_id): Path<Uuid>,
) -> Result<Json<Vec<ParticipantDto>>, ApiError> {
    let latest_participants = db::fetch_latest_participants(&state.db, offer_id).await?;

    if latest_participants.is_empty() {
        return Err(ApiError::NotFound(offer_id.to_string()));
    }

    Ok(Json(latest_participants))
}

#[tracing::instrument(name = "Getting offer ids by script", skip(state, query))]
pub async fn get_offer_ids_by_script(
    State(state): State<Arc<AppState>>,
    Query(query): Query<ScriptQuery>,
) -> Result<Json<Vec<Uuid>>, ApiError> {
    let script_bytes = hex::decode(&query.script_pubkey)
        .map_err(|_| ApiError::BadRequest("Invalid script_pubkey hex".to_string()))?;

    let ids = db::fetch_offer_ids_by_script(&state.db, &script_bytes).await?;

    Ok(Json(ids))
}
