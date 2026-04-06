use clap::Parser;

use simplex::provider::{EsploraProvider, SimplicityNetwork};
use simplex::signer::Signer;

use crate::commands::account::Account;
use crate::commands::core::Command;
use crate::commands::lending::CliLending;
use crate::commands::pre_lock::CliPreLock;
use crate::commands::utility::Utility;
use crate::config::CliConfig;
use crate::error::CliError;

#[derive(Debug, Parser)]
#[command(name = "lending-cli")]
#[command(version, about = "Simplicity helper Lending CLI for Liquid testnet")]
pub struct Cli {
    #[command(subcommand)]
    pub command: Command,
}

pub struct CliContext {
    pub signer: Signer,
    pub esplora_provider: EsploraProvider,
}

impl CliContext {
    pub fn get_network(&self) -> SimplicityNetwork {
        self.esplora_provider.network
    }
}

impl Cli {
    pub async fn run(&self) -> Result<(), CliError> {
        match &self.command {
            Command::Account { command } => {
                let context = Cli::build_context()?;

                Ok(Account::run(context, command)?)
            }
            Command::Lending { command } => {
                let context = Cli::build_context()?;

                Ok(CliLending::run(context, command)?)
            }
            Command::PreLock { command } => {
                let context = Cli::build_context()?;

                Ok(CliPreLock::run(context, command)?)
            }
            Command::Utility { command } => {
                let context = Cli::build_context()?;

                Ok(Utility::run(context, command)?)
            }
        }
    }

    fn build_context() -> Result<CliContext, CliError> {
        let config = CliConfig::load_config();

        let esplora_provider = EsploraProvider::new(config.esplora_url.clone(), config.network);
        let signer = Signer::new(
            &config.mnemonic,
            Box::new(EsploraProvider::new(config.esplora_url, config.network)),
        );

        Ok(CliContext {
            signer,
            esplora_provider,
        })
    }
}
