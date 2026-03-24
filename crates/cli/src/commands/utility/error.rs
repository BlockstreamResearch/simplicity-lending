use lending_contracts::transactions::utility::UtilityTransactionError;
use simplex::{provider::ProviderError, signer::SignerError, simplicityhl::simplicity::hex::HexToArrayError};

#[derive(thiserror::Error, Debug)]
pub enum UtilityCommandError {
    #[error("Invalid preparation UTXOs count: expected - {expected}, actual - {actual}")]
    InvalidPreparationUTXOsCount {expected: usize, actual: usize},

    #[error("Failed to build utility transaction: {0}")]
    UtilityTransaction(#[from] UtilityTransactionError),

    #[error("Simplex Signer error: {0}")]
    Signer(#[from] SignerError),

    #[error("Simplex Provider error: {0}")]
    Provider(#[from] ProviderError),

    #[error("Hex to array error: {0}")]
    HexToArray(#[from] HexToArrayError),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}
