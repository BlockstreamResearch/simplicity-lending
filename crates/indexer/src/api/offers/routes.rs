use std::sync::Arc;

use axum::{Router, routing::get};

use crate::api::AppState;

use super::handlers;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/offers", get(handlers::list_offers))
        .route("/offers/by-script", get(handlers::get_ids_by_script))
        .route("/offers/{id}", get(handlers::get_details))
}
