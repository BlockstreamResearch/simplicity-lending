use std::sync::Arc;

use axum::Router;
use sqlx::PgPool;
use tokio::net::TcpListener;

use tower_http::request_id::{self, MakeRequestUuid, RequestId};
use tower_http::trace::TraceLayer;

use crate::api::assets;
use crate::api::borrowers;
use crate::api::events::{self, EventBus, spawn_indexer_events_listener};
use crate::api::factories;
use crate::api::health;
use crate::api::lenders;
use crate::api::offers;
use crate::api::openapi;
use crate::api::state::AppState;

pub async fn run_server(listener: TcpListener, db_pool: PgPool) {
    let events = EventBus::new();
    spawn_indexer_events_listener(db_pool.clone(), events.clone());

    let state = Arc::new(AppState {
        db: db_pool,
        events,
    });

    let app = Router::new()
        .merge(health::routes())
        .merge(events::routes())
        .merge(borrowers::routes())
        .merge(lenders::routes())
        .merge(factories::routes())
        .merge(offers::routes())
        .merge(assets::routes());

    #[cfg(feature = "swagger-ui")]
    let app = app.merge(openapi::swagger_routes());

    let app = app
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
