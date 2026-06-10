use simplex::{provider::ProviderError, signer::SignerError};

#[derive(thiserror::Error, Debug)]
pub enum IssuanceCommandError {
    #[error("Simplex Signer error: {0}")]
    Signer(#[from] SignerError),

    #[error("Simplex Provider error: {0}")]
    Provider(#[from] ProviderError),

    #[error("Invalid entropy hex `{entropy}`: {source}")]
    InvalidEntropyHex {
        entropy: String,
        source: hex::FromHexError,
    },

    #[error("Entropy must be exactly 32 bytes (64 hex chars), got {actual_bytes} bytes")]
    InvalidEntropyLength { actual_bytes: usize },
}
