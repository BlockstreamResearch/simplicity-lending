use simplex::{
    provider::ProviderError,
    simplicityhl::elements::{Txid, hashes::FromSliceError},
};

#[derive(thiserror::Error, Debug)]
pub enum PreLockError {
    #[error("Invalid creation OP_RETURN data length: expected - {expected}, actual - {actual}")]
    InvalidCreationOpReturnDataLength { expected: usize, actual: usize },

    #[error("Invalid OP_RETURN borrower pubkey bytes: {0}")]
    InvalidOpReturnBytes(String),

    #[error("Confidential assets currently are not supported")]
    ConfidentialAssetsAreNotSupported(),

    #[error("Passed transaction is not a pre lock creation transaction")]
    NotAPreLockCreationTx(Txid),

    #[error("Failed to convert OP_RETURN asset id bytes to valid asset id: {0}")]
    FromSlice(#[from] FromSliceError),

    #[error(transparent)]
    SimplexProvider(#[from] ProviderError),
}
