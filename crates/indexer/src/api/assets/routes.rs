use std::sync::Arc;

use axum::{Router, routing::get};

use crate::api::AppState;

use super::handlers;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new().route("/.well-known/{proof_file}", get(handlers::get_domain_proof))
}
