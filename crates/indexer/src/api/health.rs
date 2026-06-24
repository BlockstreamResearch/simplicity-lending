use std::sync::Arc;

use axum::{Json, Router, extract::State, http::StatusCode, response::IntoResponse, routing::get};
use serde::Serialize;
use utoipa::ToSchema;

use crate::api::AppState;

#[derive(Serialize, ToSchema)]
pub struct HealthResponse {
    status: String,
}

impl HealthResponse {
    fn ok() -> Self {
        Self {
            status: "ok".to_string(),
        }
    }

    fn unavailable() -> Self {
        Self {
            status: "unavailable".to_string(),
        }
    }
}

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/health", get(health))
        .route("/ready", get(ready))
}

#[utoipa::path(
    get,
    path = "/health",
    tag = "health",
    operation_id = "get_health",
    responses(
        (status = 200, description = "API process is alive", body = HealthResponse),
    )
)]
pub async fn health() -> Json<HealthResponse> {
    Json(HealthResponse::ok())
}

#[utoipa::path(
    get,
    path = "/ready",
    tag = "health",
    operation_id = "get_readiness",
    responses(
        (status = 200, description = "API process can reach its database", body = HealthResponse),
        (status = 503, description = "API process is not ready", body = HealthResponse),
    )
)]
#[tracing::instrument(name = "Checking API readiness", skip(state))]
pub async fn ready(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    match sqlx::query("SELECT 1").execute(&state.db).await {
        Ok(_) => (StatusCode::OK, Json(HealthResponse::ok())).into_response(),
        Err(error) => {
            tracing::error!(?error, "Readiness check failed");
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(HealthResponse::unavailable()),
            )
                .into_response()
        }
    }
}
