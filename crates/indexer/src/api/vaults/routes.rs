use std::sync::Arc;

use axum::{Router, routing::get};

use crate::api::AppState;

use super::handlers;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new().nest(
        "/vaults",
        Router::new().route("/protocol-fee", get(handlers::list_protocol_fee_vaults)),
    )
}
