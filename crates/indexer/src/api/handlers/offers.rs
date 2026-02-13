use std::sync::Arc;

use axum::{
    Json,
    extract::{Path, Query, State},
};
use uuid::Uuid;

use crate::api::dto::{OfferListItemFull, OfferListItemShort};
use crate::api::{ApiError, AppState, Pagination, db, dto::OfferDetailsResponse};

#[tracing::instrument(name = "Getting offers short info", skip(state, pagination))]
pub async fn get_offers_short_info(
    State(state): State<Arc<AppState>>,
    Query(pagination): Query<Pagination>,
) -> Result<Json<Vec<OfferListItemShort>>, ApiError> {
    let offers = db::fetch_offers_short_info_list(&state.db, pagination).await?;

    Ok(Json(offers))
}

#[tracing::instrument(name = "Getting offers full info", skip(state, pagination))]
pub async fn get_offers_full_info(
    State(state): State<Arc<AppState>>,
    Query(pagination): Query<Pagination>,
) -> Result<Json<Vec<OfferListItemFull>>, ApiError> {
    let offers = db::fetch_offers_full_info_list(&state.db, pagination).await?;

    Ok(Json(offers))
}

#[tracing::instrument(name = "Getting offers full info", skip(state, offer_id))]
pub async fn get_offer_details(
    State(state): State<Arc<AppState>>,
    Path(offer_id): Path<Uuid>,
) -> Result<Json<OfferDetailsResponse>, ApiError> {
    let offer_info = db::fetch_offer_full_info_by_id(&state.db, offer_id)
        .await?
        .ok_or_else(|| ApiError::NotFound(offer_id.to_string()))?;

    let participants = db::fetch_latest_participants(&state.db, offer_id).await?;

    Ok(Json(OfferDetailsResponse {
        info: offer_info,
        participants,
    }))
}
