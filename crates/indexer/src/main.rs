use sqlx::PgPool;
use tokio::net::TcpListener;

use lending_indexer::api;
use lending_indexer::configuration::Settings;
use lending_indexer::indexer::{EsploraChainSource, Worker};
use lending_indexer::telemetry::{get_subscriber, init_subscriber};

#[tokio::main]
async fn main() -> Result<(), std::io::Error> {
    let _ = dotenvy::dotenv();

    let subscriber = get_subscriber("lending-indexer".into(), "info".into(), std::io::stdout);
    init_subscriber(subscriber);

    let configuration = Settings::load().expect("Failed to read configuration");
    let pool =
        PgPool::connect_lazy(&configuration.database.url).expect("Failed to connect to Postgres.");

    let run_mode = std::env::var("RUN_MODE").unwrap_or_else(|_| "api".into());

    match run_mode.as_str() {
        "indexer" => {
            let chain = EsploraChainSource::new(&configuration.esplora);
            let network = chain.network();

            tracing::info!("Starting indexer service");

            let mut worker = Worker::new(configuration.indexer, pool, chain, network)
                .await
                .expect("Failed to start indexer service");

            worker.run().await;
        }
        _ => {
            let address = format!(
                "{}:{}",
                configuration.application.host, configuration.application.port
            );
            let listener = TcpListener::bind(address).await?;

            tracing::info!("Starting api server");
            api::server::run_server(listener, pool).await;
        }
    }

    Ok(())
}
