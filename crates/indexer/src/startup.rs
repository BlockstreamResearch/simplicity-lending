use axum::{Router, routing::get};
use tokio::net::TcpListener;

use crate::routes::greet;

pub async fn run(listener: TcpListener) {
    let app = Router::new().route("/", get(greet));

    axum::serve(listener, app).await.unwrap()
}
