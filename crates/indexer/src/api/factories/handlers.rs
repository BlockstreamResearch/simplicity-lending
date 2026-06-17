use std::sync::Arc;

use axum::{
    Json,
    extract::{Path, Query, State},
};
use uuid::Uuid;

use crate::api::error::ErrorResponse;
use crate::api::params::ScriptQuery;
use crate::api::{ApiError, AppState};

use super::dto::FactoryDetailsResponse;

#[utoipa::path(
    get,
    path = "/factories/by-script",
    tag = "factories",
    params(ScriptQuery),
    responses(
        (status = 200, description = "Active factories owned by the script", body = Vec<FactoryDetailsResponse>),
        (status = 400, description = "Invalid script_pubkey hex", body = ErrorResponse),
        (status = 500, description = "Internal server error", body = ErrorResponse),
    )
)]
#[tracing::instrument(name = "Getting factories by script", skip(state, query))]
pub async fn get_by_script(
    State(state): State<Arc<AppState>>,
    Query(query): Query<ScriptQuery>,
) -> Result<Json<Vec<FactoryDetailsResponse>>, ApiError> {
    let script_bytes = hex::decode(&query.script_pubkey)
        .map_err(|_| ApiError::BadRequest("Invalid script_pubkey hex".to_string()))?;

    let factories = super::db::fetch_by_script(&state.db, &script_bytes).await?;

    Ok(Json(factories))
}

#[utoipa::path(
    get,
    path = "/factories/{id}",
    tag = "factories",
    params(("id" = Uuid, Path, description = "Factory UUID")),
    responses(
        (status = 200, description = "Factory details with latest auth/program UTXOs", body = FactoryDetailsResponse),
        (status = 404, description = "Factory not found", body = ErrorResponse),
        (status = 500, description = "Internal server error", body = ErrorResponse),
    )
)]
#[tracing::instrument(name = "Getting factory by id", skip(state, factory_id))]
pub async fn get_by_id(
    State(state): State<Arc<AppState>>,
    Path(factory_id): Path<Uuid>,
) -> Result<Json<FactoryDetailsResponse>, ApiError> {
    let factory = super::db::fetch_by_id(&state.db, factory_id)
        .await?
        .ok_or_else(|| ApiError::NotFound(factory_id.to_string()))?;

    Ok(Json(factory))
}
