use simplex::signer::SignerError;

use crate::commands::{
    account::AccountCommandError, lending::LendingCommandError, pre_lock::PreLockCommandError,
    utility::UtilityCommandError,
};

#[derive(thiserror::Error, Debug)]
pub enum CliError {
    #[error(transparent)]
    UserAccountCommand(#[from] AccountCommandError),

    #[error(transparent)]
    LendingCommand(#[from] LendingCommandError),

    #[error(transparent)]
    PreLockCommand(#[from] PreLockCommandError),

    #[error(transparent)]
    UtilityCommand(#[from] UtilityCommandError),

    #[error("Failed to create signer: '{0}'")]
    Signer(#[from] SignerError),

    #[error("IO error: '{0}'")]
    Io(#[from] std::io::Error),
}
