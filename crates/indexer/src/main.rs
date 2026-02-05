use tokio::net::TcpListener;

use lending_indexer::configuration::get_configuration;
use lending_indexer::startup::run;

#[tokio::main]
async fn main() -> Result<(), std::io::Error> {
    let configuration = get_configuration().expect("Failed to read configuration");

    let address = format!("127.0.0.1:{}", configuration.application_port);
    let listener = TcpListener::bind(address).await?;

    run(listener).await;

    Ok(())
}
