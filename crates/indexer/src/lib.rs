use axum::{Router, routing::get};
use tokio::net::TcpListener;

pub mod esplora_client;

async fn greet() -> &'static str {
    "Hello from indexer"
}

pub async fn run(listener: TcpListener) {
    let app = Router::new().route("/", get(greet));

    axum::serve(listener, app).await.unwrap()
}
