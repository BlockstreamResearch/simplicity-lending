use clap::Subcommand;

use crate::commands::{account::AccountCommand, pre_lock::PreLockCommand, utility::UtilityCommand};

#[derive(Debug, Subcommand)]
pub enum Command {
    Utility {
        #[command(subcommand)]
        command: UtilityCommand,
    },
    Account {
        #[command(subcommand)]
        command: AccountCommand,
    },
    PreLock {
        #[command(subcommand)]
        command: PreLockCommand,
    },
}
