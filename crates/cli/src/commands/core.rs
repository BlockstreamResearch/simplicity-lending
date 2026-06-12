use clap::Subcommand;

use crate::commands::{
    account::AccountCommand, factory::FactoryCommand, issuance::IssuanceCommand,
};

#[derive(Debug, Subcommand)]
pub enum Command {
    /// Account helper commands
    Account {
        #[command(subcommand)]
        command: AccountCommand,
    },
    /// Issuance factory (borrower account) commands
    Factory {
        #[command(subcommand)]
        command: FactoryCommand,
    },
    /// Issuance related commands
    Issuance {
        #[command(subcommand)]
        command: IssuanceCommand,
    },
}
