use std::sync::Arc;

use axum::{
    Json,
    extract::{Query, State},
};

use crate::api::openapi::ErrorResponse;
use crate::api::utils::parse_filter_hex;
use crate::api::{ApiError, AppState};

use super::dto::{ProtocolFeeVaultsQuery, ProtocolFeeVaultsResponse};

#[utoipa::path(
    get,
    path = "/vaults/protocol-fee",
    tag = "vaults",
    params(ProtocolFeeVaultsQuery),
    responses(
        (status = 200, description = "Unspent, finalized protocol-fee vaults for the asset, sorted by amount desc", body = ProtocolFeeVaultsResponse),
        (status = 400, description = "Invalid principal_asset hex", body = ErrorResponse),
        (status = 500, description = "Internal server error", body = ErrorResponse),
    )
)]
#[tracing::instrument(name = "Getting unspent protocol-fee vaults", skip(state, query))]
pub async fn list_protocol_fee_vaults(
    State(state): State<Arc<AppState>>,
    Query(query): Query<ProtocolFeeVaultsQuery>,
) -> Result<Json<ProtocolFeeVaultsResponse>, ApiError> {
    let asset_bytes = parse_filter_hex(&query.principal_asset)
        .ok_or_else(|| ApiError::BadRequest("Invalid principal_asset hex".to_string()))?;

    let response = super::db::fetch_unspent_protocol_fee_vaults(&state.db, asset_bytes).await?;

    Ok(Json(response))
}
