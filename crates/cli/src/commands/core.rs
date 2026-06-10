use clap::Subcommand;

use crate::commands::{account::AccountCommand, issuance::IssuanceCommand};

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
}
