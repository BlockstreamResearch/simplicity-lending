use simplex::simplicityhl::elements::hashes::FromSliceError;

#[derive(thiserror::Error, Debug)]
pub enum PreLockError {
    #[error("Invalid creation OP_RETURN data length: expected - {expected}, actual - {actual}")]
    InvalidCreationOpReturnDataLength { expected: usize, actual: usize },

    #[error("Invalid OP_RETURN borrower pubkey bytes: {0}")]
    InvalidOpReturnBytes(String),

    #[error("Failed to convert OP_RETURN asset id bytes to valid asset id: {0}")]
    FromSlice(#[from] FromSliceError),
}
