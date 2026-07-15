use lending_indexer::api::server::run_server;
use sqlx::PgPool;
use tokio::net::TcpListener;

pub async fn start_indexer_api(
    pool: PgPool,
) -> anyhow::Result<(String, tokio::task::JoinHandle<()>)> {
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let addr = listener.local_addr()?;
    let handle = tokio::spawn(async move {
        run_server(listener, pool).await;
    });

    Ok((format!("http://{addr}"), handle))
}
