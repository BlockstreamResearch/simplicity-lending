use clap::{Parser, Subcommand};
use lending_indexer::client::IndexerClient;

use crate::AppContext;
use crate::commands;
use crate::config;
use crate::error::HarvesterError;

#[derive(Debug, Parser)]
#[command(name = "lending-harvester")]
#[command(version, about = "Collect protocol fees into the fee collector UTXO")]
pub struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    /// Run the scheduled harvest loop
    Run,
    /// Run a single harvest pass
    Harvest,
    /// Create the initial fee collector UTXO
    Bootstrap,
    /// Withdraw from the fee collector
    Withdraw {
        /// Destination address (overrides config)
        #[arg(long)]
        to: Option<String>,
    },
}

impl Cli {
    pub async fn parse_and_run() -> Result<(), HarvesterError> {
        Self::parse().run().await
    }

    async fn run(self) -> Result<(), HarvesterError> {
        let settings = config::get_configuration()?;
        let indexer = IndexerClient::new(&settings.indexer.base_url)?;
        let ctx = AppContext { settings, indexer };

        let result = match self.command {
            Command::Run => commands::run(&ctx).await,
            Command::Harvest => commands::harvest(&ctx).await,
            Command::Bootstrap => commands::bootstrap(&ctx).await,
            Command::Withdraw { to } => commands::withdraw(&ctx, to.as_deref()).await,
        };
        if let Err(error) = &result {
            tracing::error!("{error}");
        }
        result
    }
}
