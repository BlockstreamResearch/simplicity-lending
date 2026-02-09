use std::sync::Arc;

use lending_indexer::esplora_client::EsploraClient;
use lending_indexer::indexer::run_indexer;
use lending_indexer::telemetry::{get_subscriber, init_subscriber};
use sqlx::PgPool;
use tokio::net::TcpListener;

use lending_indexer::configuration::get_configuration;
use lending_indexer::startup::run;

#[tokio::main]
async fn main() -> Result<(), std::io::Error> {
    let subscriber = get_subscriber("lending-indexer".into(), "info".into(), std::io::stdout);
    init_subscriber(subscriber);

    let configuration = get_configuration().expect("Failed to read configuration");

    let connection_pool = Arc::new(
        PgPool::connect(&configuration.database.connection_string())
            .await
            .expect("Failed to connect to Postgres."),
    );

    let address = format!("127.0.0.1:{}", configuration.application_port);
    let listener = TcpListener::bind(address).await?;

    let esplora_client = EsploraClient::with_base_url(&configuration.esplora.base_url);

    let indexer_db = Arc::clone(&connection_pool);

    let _indexer_handle = tokio::spawn(async move {
        run_indexer(configuration.indexer, indexer_db, esplora_client).await
    });

    run(listener, connection_pool).await;

    Ok(())
}
