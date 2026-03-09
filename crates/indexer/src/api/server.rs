use std::{io, sync::Arc};

use axum::{
    Json, Router,
    http::{HeaderValue, Method, Uri},
    routing::{get, post},
};
use sqlx::PgPool;
use tokio::net::TcpListener;
use tokio::task::JoinSet;
use tower_http::cors::{AllowOrigin, Any, CorsLayer};
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

fn parse_allowed_origins(origins: &[String]) -> Result<Option<Vec<HeaderValue>>, String> {
    let normalized = origins
        .iter()
        .map(|origin| origin.trim())
        .filter(|origin| !origin.is_empty())
        .collect::<Vec<_>>();

    if normalized.is_empty() || normalized.contains(&"*") {
        return Ok(None);
    }

    let mut parsed = Vec::with_capacity(normalized.len());

    for origin in normalized {
        origin
            .parse::<Uri>()
            .map_err(|error| format!("`{origin}` is not a valid URI: {error}"))?;

        let header = HeaderValue::from_str(origin)
            .map_err(|error| format!("`{origin}` is not a valid header value: {error}"))?;

        parsed.push(header);
    }

    Ok(Some(parsed))
}

fn build_cors_layer(allowed_origins: &[String]) -> io::Result<CorsLayer> {
    let base = CorsLayer::new()
        .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
        .allow_headers(Any);

    let parsed_origins = parse_allowed_origins(allowed_origins).map_err(|error| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("Invalid CORS origin in configuration: {error}"),
        )
    })?;

    Ok(match parsed_origins {
        None => base.allow_origin(Any),
        Some(origins) => base.allow_origin(AllowOrigin::list(origins)),
    })
}

async fn healthcheck() -> Json<serde_json::Value> {
    Json(serde_json::json!({ "status": "ok" }))
}

fn build_app(state: Arc<AppState>, cors: CorsLayer) -> Router {
    Router::new()
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
        .layer(cors)
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
        .layer(request_id::SetRequestIdLayer::x_request_id(MakeRequestUuid))
}

fn format_bind_target(host: &str, port: u16) -> String {
    if host.contains(':') && !host.starts_with('[') {
        format!("[{host}]:{port}")
    } else {
        format!("{host}:{port}")
    }
}

pub fn listener_bind_targets(host: &str, port: u16) -> Vec<String> {
    match host {
        "127.0.0.1" | "localhost" => vec![
            format_bind_target("127.0.0.1", port),
            format_bind_target("::1", port),
        ],
        "0.0.0.0" => vec![
            format_bind_target("0.0.0.0", port),
            format_bind_target("::", port),
        ],
        _ => vec![format_bind_target(host, port)],
    }
}

pub async fn bind_listeners(host: &str, port: u16) -> io::Result<Vec<TcpListener>> {
    let mut listeners = Vec::new();
    let mut first_error = None;

    for bind_target in listener_bind_targets(host, port) {
        match TcpListener::bind(&bind_target).await {
            Ok(listener) => listeners.push(listener),
            Err(error) => {
                if listeners.is_empty() && first_error.is_none() {
                    first_error = Some(io::Error::new(
                        error.kind(),
                        format!("failed to bind {bind_target}: {error}"),
                    ));
                } else {
                    tracing::warn!(%bind_target, %error, "Failed to bind API listener");
                }
            }
        }
    }

    if listeners.is_empty() {
        return Err(first_error.unwrap_or_else(|| io::Error::other("failed to bind API listener")));
    }

    Ok(listeners)
}

pub async fn run_server(
    listeners: Vec<TcpListener>,
    db_pool: PgPool,
    allowed_origins: &[String],
) -> io::Result<()> {
    let state = Arc::new(AppState { db: db_pool });
    let cors = build_cors_layer(allowed_origins)?;
    let app = build_app(state, cors);
    let mut servers = JoinSet::new();

    for listener in listeners {
        let app = app.clone();
        servers.spawn(async move { axum::serve(listener, app).await });
    }

    match servers.join_next().await {
        Some(Ok(result)) => result,
        Some(Err(error)) => Err(io::Error::other(format!("API server task failed: {error}"))),
        None => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::{listener_bind_targets, parse_allowed_origins};

    #[test]
    fn localhost_binds_ipv4_and_ipv6_loopback() {
        assert_eq!(
            listener_bind_targets("localhost", 8000),
            vec!["127.0.0.1:8000", "[::1]:8000"]
        );
    }

    #[test]
    fn ipv4_any_binds_dual_stack_targets() {
        assert_eq!(
            listener_bind_targets("0.0.0.0", 8000),
            vec!["0.0.0.0:8000", "[::]:8000"]
        );
    }

    #[test]
    fn custom_host_is_preserved() {
        assert_eq!(
            listener_bind_targets("192.168.1.50", 9000),
            vec!["192.168.1.50:9000"]
        );
    }

    #[test]
    fn empty_cors_origins_defaults_to_wildcard() {
        assert_eq!(parse_allowed_origins(&[]).unwrap(), None);
    }

    #[test]
    fn wildcard_cors_origin_defaults_to_any() {
        assert_eq!(parse_allowed_origins(&["*".into()]).unwrap(), None);
    }

    #[test]
    fn explicit_cors_origins_are_preserved() {
        let origins = parse_allowed_origins(&[
            "https://app.example.com".into(),
            "https://admin.example.com".into(),
        ])
        .unwrap()
        .unwrap();

        assert_eq!(origins.len(), 2);
        assert_eq!(origins[0], "https://app.example.com");
        assert_eq!(origins[1], "https://admin.example.com");
    }

    #[test]
    fn invalid_cors_origin_is_rejected() {
        assert!(parse_allowed_origins(&["https://bad origin.example.com".into()]).is_err());
    }
}
