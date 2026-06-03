use simplex::signer::SignerError;

use crate::commands::{
    account::AccountCommandError, issuance::IssuanceCommandError, utility::UtilityCommandError,
};

#[derive(thiserror::Error, Debug)]
pub enum CliError {
    #[error(transparent)]
    UserAccountCommand(#[from] AccountCommandError),

    #[error(transparent)]
    IssuanceCommand(#[from] IssuanceCommandError),

    #[error(transparent)]
    UtilityCommand(#[from] UtilityCommandError),

    #[error("Failed to create signer: '{0}'")]
    Signer(#[from] SignerError),

    #[error("IO error: '{0}'")]
    Io(#[from] std::io::Error),
}
