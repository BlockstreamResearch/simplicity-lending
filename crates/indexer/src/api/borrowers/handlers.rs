use std::sync::Arc;

use axum::{
    Json,
    extract::{Query, State},
};

use crate::api::{ApiError, AppState};

use super::dto::{BorrowerDashboardQuery, BorrowerDashboardResponse};

#[tracing::instrument(name = "Getting borrower dashboard by script", skip(state, query))]
pub async fn get_by_script(
    State(state): State<Arc<AppState>>,
    Query(query): Query<BorrowerDashboardQuery>,
) -> Result<Json<BorrowerDashboardResponse>, ApiError> {
    let script_bytes = hex::decode(&query.script_pubkey)
        .map_err(|_| ApiError::BadRequest("Invalid script_pubkey hex".to_string()))?;

    let dashboard = super::db::fetch_dashboard(&state.db, &script_bytes, query.filters).await?;

    Ok(Json(dashboard))
}
