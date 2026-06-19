use std::sync::Arc;

use axum::{Router, routing::get};

use crate::api::AppState;

use super::handlers;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/borrowers/overview", get(handlers::get_overview_by_script))
        .route("/borrowers/offers", get(handlers::list_offers_by_script))
}
