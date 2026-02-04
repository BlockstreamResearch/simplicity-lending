use axum::{Router, routing::get};

async fn greet() -> &'static str {
    "Hello from indexer"
}

#[tokio::main]
async fn main() {
    let app = Router::new().route("/", get(greet));

    let listener = tokio::net::TcpListener::bind("127.0.0.1:3000")
        .await
        .unwrap();

    axum::serve(listener, app).await.unwrap()
}
