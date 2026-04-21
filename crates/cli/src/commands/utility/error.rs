use lending_contracts::utils::ParametersError;
use simplex::{
    provider::ProviderError, signer::SignerError, simplicityhl::simplicity::hex::HexToArrayError,
};

#[derive(thiserror::Error, Debug)]
pub enum UtilityCommandError {
    #[error("Invalid preparation UTXOs count: expected - {expected}, actual - {actual}")]
    InvalidPreparationUTXOsCount { expected: usize, actual: usize },

    #[error("Parameters error: {0}")]
    Parameters(#[from] ParametersError),

    #[error("Simplex Signer error: {0}")]
    Signer(#[from] SignerError),

    #[error("Simplex Provider error: {0}")]
    Provider(#[from] ProviderError),

    #[error("Hex to array error: {0}")]
    HexToArray(#[from] HexToArrayError),
}
