use std::sync::Arc;

use axum::{
    Router,
    routing::{get, post},
};
use sqlx::PgPool;
use tokio::net::TcpListener;
use tower_http::request_id::{self, MakeRequestUuid, RequestId};
use tower_http::trace::TraceLayer;

use crate::api::handlers::{
    get_latest_offer_participants, get_offer_details, get_offer_details_batch,
    get_offer_ids_by_script, get_offer_participants_history, get_offer_utxos_history,
    get_offers_full_info, get_offers_short_info, get_pending_offers_by_borrower,
};

pub struct AppState {
    pub db: PgPool,
}

async fn healthcheck() -> &'static str {
    "ok"
}

pub async fn run_server(listener: TcpListener, db_pool: PgPool) {
    let state = Arc::new(AppState { db: db_pool });

    let app = Router::new()
        .route("/health", get(healthcheck))
        .route("/offers", get(get_offers_short_info))
        .route("/offers/full", get(get_offers_full_info))
        .route("/offers/batch", post(get_offer_details_batch))
        .route("/offers/by-script", get(get_offer_ids_by_script))
        .route(
            "/offers/by-borrower-pubkey",
            get(get_pending_offers_by_borrower),
        )
        .route("/offers/{id}", get(get_offer_details))
        .route(
            "/offers/{id}/participants/history",
            get(get_offer_participants_history),
        )
        .route(
            "/offers/{id}/participants",
            get(get_latest_offer_participants),
        )
        .route("/offers/{id}/utxos", get(get_offer_utxos_history))
        .with_state(state)
        .layer(
            TraceLayer::new_for_http().make_span_with(|request: &axum::http::Request<_>| {
                let request_id = request
                    .extensions()
                    .get::<RequestId>()
                    .map(|id| id.header_value().to_str().unwrap_or("default"))
                    .unwrap_or("unknown");

                tracing::info_span!(
                    "http_request",
                    %request_id,
                    method = %request.method(),
                    uri = %request.uri()
                )
            }),
        )
        .layer(request_id::PropagateRequestIdLayer::x_request_id())
        .layer(request_id::SetRequestIdLayer::x_request_id(MakeRequestUuid));

    axum::serve(listener, app).await.unwrap()
}
