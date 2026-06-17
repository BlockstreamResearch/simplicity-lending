use std::sync::Arc;

use axum::{
    Json,
    extract::{Query, State},
};

use crate::api::openapi::ErrorResponse;
use crate::api::utils::parse_script_pubkey;
use crate::api::{ApiError, AppState, BorrowerDashboardQuery};

use super::dto::BorrowerDashboardResponse;

#[utoipa::path(
    get,
    path = "/borrowers/by-script",
    tag = "borrowers",
    params(BorrowerDashboardQuery),
    responses(
        (status = 200, description = "Borrower overview and paginated offer list", body = BorrowerDashboardResponse),
        (status = 400, description = "Invalid script_pubkey hex", body = ErrorResponse),
        (status = 500, description = "Internal server error", body = ErrorResponse),
    )
)]
#[tracing::instrument(name = "Getting borrower dashboard by script", skip(state, query))]
pub async fn get_by_script(
    State(state): State<Arc<AppState>>,
    Query(query): Query<BorrowerDashboardQuery>,
) -> Result<Json<BorrowerDashboardResponse>, ApiError> {
    let script_bytes = parse_script_pubkey(&query.script_pubkey)?;

    let dashboard = super::db::fetch_dashboard(&state.db, &script_bytes, query.filters).await?;

    Ok(Json(dashboard))
}
