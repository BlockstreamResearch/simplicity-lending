use simplex::signer::SignerError;

use crate::commands::{
    account::AccountCommandError, pre_lock::PreLockCommandError, utility::UtilityCommandError,
};

#[derive(thiserror::Error, Debug)]
pub enum CliError {
    #[error(transparent)]
    UtilityCommand(#[from] UtilityCommandError),

    #[error(transparent)]
    UserAccountCommand(#[from] AccountCommandError),

    #[error(transparent)]
    PreLockCommand(#[from] PreLockCommandError),

    #[error("Failed to create signer: '{0}'")]
    Signer(#[from] SignerError),

    #[error("IO error: '{0}'")]
    Io(#[from] std::io::Error),
}
