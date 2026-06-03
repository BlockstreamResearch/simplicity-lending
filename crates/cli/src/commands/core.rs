use clap::Subcommand;

use crate::commands::{
    account::AccountCommand, issuance::IssuanceCommand, utility::UtilityCommand,
};

#[derive(Debug, Subcommand)]
pub enum Command {
    /// Account helper commands
    Account {
        #[command(subcommand)]
        command: AccountCommand,
    },
    /// Issuance related commands
    Issuance {
        #[command(subcommand)]
        command: IssuanceCommand,
    },
    /// Utility helper commands
    Utility {
        #[command(subcommand)]
        command: UtilityCommand,
    },
}
