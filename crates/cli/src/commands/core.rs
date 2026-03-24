use clap::{Args, Subcommand};

use crate::commands::utility::UtilityCommand;

#[derive(Debug, Subcommand)]
pub enum Command {
    Utility {
        #[command(subcommand)]
        command: UtilityCommand,
    },
}

