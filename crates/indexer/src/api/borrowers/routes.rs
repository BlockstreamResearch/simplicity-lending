use std::sync::Arc;

use axum::{Router, routing::get};

use crate::api::AppState;

use super::handlers;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new().route("/borrowers/by-script", get(handlers::get_by_script))
}
