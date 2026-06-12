use std::sync::Arc;

use axum::{
    Router,
    routing::{get, post},
};

use crate::api::AppState;

use super::handlers;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/offers", get(handlers::get_short_info))
        .route("/offers/full", get(handlers::get_full_info))
        .route("/offers/batch", post(handlers::get_details_batch))
        .route("/offers/by-script", get(handlers::get_ids_by_script))
        .route("/offers/{id}", get(handlers::get_details))
        .route(
            "/offers/{id}/participants/history",
            get(handlers::get_participants_history),
        )
        .route(
            "/offers/{id}/participants",
            get(handlers::get_latest_participants),
        )
        .route("/offers/{id}/utxos", get(handlers::get_utxos_history))
}
