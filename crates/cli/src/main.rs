use anyhow::Result;
use clap::{Parser, Subcommand};

use simplicity_contracts_cli::commands::basic::Basic;

/// Command-line entrypoint for the Simplicity helper CLI.
#[derive(Parser, Debug)]
#[command(
    name = "simplicity-lending-cli",
    version,
    about = "Simplicity helper Lending CLI for Liquid testnet"
)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

/// Top-level subcommand groups.
#[derive(Subcommand, Debug)]
enum Commands {
    /// P2PK and simple transaction utilities
    Basic {
        #[command(subcommand)]
        basic: Box<Basic>,
    },
}

#[tokio::main]
async fn main() -> Result<()> {
    match Cli::parse().command {
        Commands::Basic { basic } => basic.handle().await,
    }
}
