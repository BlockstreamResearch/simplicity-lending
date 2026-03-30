use clap::Subcommand;

use crate::commands::{
    account::AccountCommand, lending::LendingCommand, pre_lock::PreLockCommand,
    utility::UtilityCommand,
};

#[derive(Debug, Subcommand)]
pub enum Command {
    Account {
        #[command(subcommand)]
        command: AccountCommand,
    },
    Lending {
        #[command(subcommand)]
        command: LendingCommand,
    },
    PreLock {
        #[command(subcommand)]
        command: PreLockCommand,
    },
    Utility {
        #[command(subcommand)]
        command: UtilityCommand,
    },
}
