use clap::Parser;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let _ = dotenvy::dotenv();

    Box::pin(lending_cli::cli::Cli::parse().run()).await?;

    Ok(())
}
