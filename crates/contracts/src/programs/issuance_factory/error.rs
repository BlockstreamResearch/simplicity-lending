#[derive(thiserror::Error, Debug)]
pub enum IssuanceFactoryError {
    #[error("Invalid creation OP_RETURN data length: expected - {expected}, actual - {actual}")]
    InvalidCreationOpReturnDataLength { expected: usize, actual: usize },

    #[error("Invalid OP_RETURN owner pubkey bytes: {0}")]
    InvalidOpReturnBytes(String),
}
