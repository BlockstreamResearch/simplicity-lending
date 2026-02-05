use std::sync::Arc;

use axum::{Router, routing::get};
use sqlx::PgPool;
use tokio::net::TcpListener;

use crate::routes::greet;

pub async fn run(listener: TcpListener, _db_pool: Arc<PgPool>) {
    let app = Router::new().route("/", get(greet));

    axum::serve(listener, app).await.unwrap()
}
