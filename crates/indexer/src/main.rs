use sqlx::PgPool;
use tokio::net::TcpListener;

use lending_indexer::configuration::get_configuration;
use lending_indexer::startup::run;

#[tokio::main]
async fn main() -> Result<(), std::io::Error> {
    let configuration = get_configuration().expect("Failed to read configuration");

    let connection_pool = PgPool::connect(&configuration.database.connection_string())
        .await
        .expect("Failed to connect to Postgres.");

    let address = format!("127.0.0.1:{}", configuration.application_port);
    let listener = TcpListener::bind(address).await?;

    run(listener, connection_pool).await;

    Ok(())
}
