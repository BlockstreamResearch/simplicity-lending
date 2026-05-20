use simplex::{provider::ProviderError, signer::SignerError};

#[derive(thiserror::Error, Debug)]
pub enum UtilityCommandError {
    #[error("Simplex Signer error: {0}")]
    Signer(#[from] SignerError),

    #[error("Simplex Provider error: {0}")]
    Provider(#[from] ProviderError),
}
