use lending_indexer::esplora_client::EsploraClient;
use lending_indexer::telemetry::{get_subscriber, init_subscriber};
use lending_indexer::{api, db, indexer};
use sqlx::PgPool;

use lending_indexer::configuration::get_configuration;

#[tokio::main]
async fn main() -> Result<(), std::io::Error> {
    let subscriber = get_subscriber("lending-indexer".into(), "info".into(), std::io::stdout);
    init_subscriber(subscriber);

    let configuration = get_configuration().expect("Failed to read configuration");
    let database_connection_string = configuration.database.connection_string();

    let run_mode = std::env::var("RUN_MODE").unwrap_or_else(|_| "api".into());

    match run_mode.as_str() {
        "migrate" => {
            tracing::info!("Running database migrations");
            let pool = PgPool::connect(&database_connection_string)
                .await
                .map_err(|error| {
                    std::io::Error::other(format!("Failed to connect to Postgres: {error}"))
                })?;

            db::run_migrations(&pool).await.map_err(|error| {
                std::io::Error::other(format!("Failed to run migrations: {error}"))
            })?;

            tracing::info!("Database migrations completed");
        }
        "indexer" => {
            let pool = PgPool::connect_lazy(&database_connection_string).map_err(|error| {
                std::io::Error::other(format!("Failed to connect to Postgres: {error}"))
            })?;
            let esplora_client = EsploraClient::with_base_url(&configuration.esplora.base_url);

            tracing::info!("Starting indexer service (background worker only; no HTTP listener)");
            indexer::worker::run_indexer(configuration.indexer, pool, esplora_client).await;
        }
        _ => {
            let pool = PgPool::connect_lazy(&database_connection_string).map_err(|error| {
                std::io::Error::other(format!("Failed to connect to Postgres: {error}"))
            })?;
            let listeners = api::server::bind_listeners(
                &configuration.application.host,
                configuration.application.port,
            )
            .await?;

            let listen_addresses = listeners
                .iter()
                .filter_map(|listener| listener.local_addr().ok())
                .map(|addr| addr.to_string())
                .collect::<Vec<_>>();

            tracing::info!(?listen_addresses, "Starting api server");
            api::server::run_server(
                listeners,
                pool,
                &configuration.application.cors.allowed_origins,
            )
            .await?;
        }
    }

    Ok(())
}
