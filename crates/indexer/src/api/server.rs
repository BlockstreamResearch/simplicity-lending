use std::sync::Arc;

use axum::Router;
use sqlx::PgPool;
use tokio::net::TcpListener;
use tower_http::request_id::{self, MakeRequestUuid, RequestId};
use tower_http::trace::TraceLayer;

use crate::api::borrowers;
use crate::api::factories;
use crate::api::offers;
use crate::api::state::AppState;

pub async fn run_server(listener: TcpListener, db_pool: PgPool) {
    let state = Arc::new(AppState { db: db_pool });

    let app = Router::new()
        .merge(borrowers::routes())
        .merge(factories::routes())
        .merge(offers::routes())
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
