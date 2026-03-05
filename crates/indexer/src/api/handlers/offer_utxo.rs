use std::sync::Arc;

use axum::{
    Json,
    extract::{Path, State},
};
use uuid::Uuid;

use crate::api::dto::OfferUtxoDto;
use crate::api::{ApiError, AppState, db};

#[tracing::instrument(name = "Getting offer utxos history", skip(state, offer_id))]
pub async fn get_offer_utxos_history(
    State(state): State<Arc<AppState>>,
    Path(offer_id): Path<Uuid>,
) -> Result<Json<Vec<OfferUtxoDto>>, ApiError> {
    let utxos_history = db::fetch_offer_utxos_history(&state.db, offer_id).await?;

    if utxos_history.is_empty() {
        return Err(ApiError::NotFound(offer_id.to_string()));
    }

    Ok(Json(utxos_history))
}
