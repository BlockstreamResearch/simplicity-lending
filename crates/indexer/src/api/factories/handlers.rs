use std::sync::Arc;

use axum::{
    Json,
    extract::{Query, State},
};

use crate::api::params::ScriptQuery;
use crate::api::{ApiError, AppState};

use super::dto::FactoryByScriptResponse;

#[tracing::instrument(name = "Getting factories by script", skip(state, query))]
pub async fn get_by_script(
    State(state): State<Arc<AppState>>,
    Query(query): Query<ScriptQuery>,
) -> Result<Json<Vec<FactoryByScriptResponse>>, ApiError> {
    let script_bytes = hex::decode(&query.script_pubkey)
        .map_err(|_| ApiError::BadRequest("Invalid script_pubkey hex".to_string()))?;

    let factories = super::db::fetch_factories_by_script(&state.db, &script_bytes).await?;

    Ok(Json(factories))
}
