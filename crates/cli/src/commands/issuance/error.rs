use simplex::simplicityhl::elements::OutPoint;
use simplex::{provider::ProviderError, signer::SignerError};

#[derive(thiserror::Error, Debug)]
pub enum IssuanceCommandError {
    #[error("Not a signer utxo: {0}")]
    NotASignerUTXO(OutPoint),

    #[error("Reissuance input must be confidential (missing unblinded secrets) for outpoint: {0}")]
    ReissuanceInputMustBeConfidential(OutPoint),

    #[error(
        "Invalid reissuance token asset for {outpoint}. Expected {expected_asset_id}, got {actual_asset_id}"
    )]
    InvalidReissuanceTokenAsset {
        outpoint: OutPoint,
        expected_asset_id: String,
        actual_asset_id: String,
    },

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
