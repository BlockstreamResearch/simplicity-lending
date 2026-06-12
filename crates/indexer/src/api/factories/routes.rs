use std::sync::Arc;

use axum::{Router, routing::get};

use crate::api::AppState;

use super::handlers;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new().nest(
        "/factories",
        Router::new().route("/by-script", get(handlers::get_by_script)),
    )
}
