use std::{str::FromStr, sync::Arc};

use axum::{
    Json,
    extract::{Path, Query, State},
};
use simplicityhl::elements::schnorr::XOnlyPublicKey;
use uuid::Uuid;

use crate::api::{ApiError, AppState, OfferFilters, db, dto::OfferDetailsResponse};
use crate::api::{
    db::fetch_pending_offer_ids_by_borrower_pubkey,
    dto::{BatchIdsRequest, OfferListItemFull, OfferListItemShort, PendingOffersQuery},
};

#[tracing::instrument(name = "Getting offers short info", skip(state, filters))]
pub async fn get_offers_short_info(
    State(state): State<Arc<AppState>>,
    Query(filters): Query<OfferFilters>,
) -> Result<Json<Vec<OfferListItemShort>>, ApiError> {
    let offers = db::fetch_offers_short_info_filtered(&state.db, filters).await?;

    Ok(Json(offers))
}

#[tracing::instrument(name = "Getting offers full info", skip(state, filters))]
pub async fn get_offers_full_info(
    State(state): State<Arc<AppState>>,
    Query(filters): Query<OfferFilters>,
) -> Result<Json<Vec<OfferListItemFull>>, ApiError> {
    let offers = db::fetch_offers_full_info_filtered(&state.db, filters).await?;

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

#[tracing::instrument(
    name = "Getting offer details by ids",
    skip(state, payload),
    fields(
        request_ids_count = %payload.ids.len()
    )
)]
pub async fn get_offer_details_batch(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<BatchIdsRequest>,
) -> Result<Json<Vec<OfferDetailsResponse>>, ApiError> {
    let result = db::fetch_offer_details_by_ids(&state.db, &payload.ids).await?;
    Ok(Json(result))
}

#[tracing::instrument(name = "Get pending offers by borrower pubkey", skip(state, query))]
pub async fn get_pending_offers_by_borrower(
    State(state): State<Arc<AppState>>,
    Query(query): Query<PendingOffersQuery>,
) -> Result<Json<Vec<Uuid>>, ApiError> {
    let borrower_pubkey = XOnlyPublicKey::from_str(&query.borrower_pubkey)
        .map_err(|_| ApiError::BadRequest("Invalid borrower_pubkey hex".to_string()))?;

    let offer_ids =
        fetch_pending_offer_ids_by_borrower_pubkey(&state.db, &borrower_pubkey.serialize()).await?;

    Ok(Json(offer_ids))
}
