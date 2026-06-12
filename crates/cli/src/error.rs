use simplex::signer::SignerError;

use crate::commands::{
    account::AccountCommandError, factory::FactoryCommandError, issuance::IssuanceCommandError,
};

#[derive(thiserror::Error, Debug)]
pub enum CliError {
    #[error(transparent)]
    UserAccountCommand(#[from] AccountCommandError),

    #[error(transparent)]
    FactoryCommand(#[from] FactoryCommandError),

    #[error(transparent)]
    IssuanceCommand(#[from] IssuanceCommandError),

    #[error("Failed to create signer: '{0}'")]
    Signer(#[from] SignerError),

    #[error("IO error: '{0}'")]
    Io(#[from] std::io::Error),
}
