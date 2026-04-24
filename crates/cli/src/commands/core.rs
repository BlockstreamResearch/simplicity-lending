use clap::Subcommand;

use crate::commands::{
    account::AccountCommand, lending::LendingCommand, pre_lock::PreLockCommand,
    utility::UtilityCommand,
};

#[derive(Debug, Subcommand)]
pub enum Command {
    /// Account helper commands
    Account {
        #[command(subcommand)]
        command: AccountCommand,
    },
    /// Lending offer related commands
    Lending {
        #[command(subcommand)]
        command: LendingCommand,
    },
    /// Offer creation commands
    PreLock {
        #[command(subcommand)]
        command: PreLockCommand,
    },
    /// Utility steps related commands
    Utility {
        #[command(subcommand)]
        command: UtilityCommand,
    },
}
