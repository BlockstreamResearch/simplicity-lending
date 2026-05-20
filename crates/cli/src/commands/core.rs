use clap::Subcommand;

use crate::commands::{account::AccountCommand, utility::UtilityCommand};

#[derive(Debug, Subcommand)]
pub enum Command {
    /// Account helper commands
    Account {
        #[command(subcommand)]
        command: AccountCommand,
    },
    /// Utility steps related commands
    Utility {
        #[command(subcommand)]
        command: UtilityCommand,
    },
}
