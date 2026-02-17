use lending_indexer::esplora_client::EsploraClient;
use lending_indexer::telemetry::{get_subscriber, init_subscriber};
use lending_indexer::{api, indexer};
use sqlx::PgPool;
use tokio::net::TcpListener;

use lending_indexer::configuration::get_configuration;

#[tokio::main]
async fn main() -> Result<(), std::io::Error> {
    let subscriber = get_subscriber("lending-indexer".into(), "info".into(), std::io::stdout);
    init_subscriber(subscriber);

    let configuration = get_configuration().expect("Failed to read configuration");
    let pool = PgPool::connect_lazy(&configuration.database.connection_string())
        .expect("Failed to connect to Postgres.");

    let run_mode = std::env::var("RUN_MODE").unwrap_or_else(|_| "api".into());

    match run_mode.as_str() {
        "indexer" => {
            let esplora_client = EsploraClient::with_base_url(&configuration.esplora.base_url);

            tracing::info!("Starting indexer service");
            indexer::worker::run_indexer(configuration.indexer, pool, esplora_client).await;
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
