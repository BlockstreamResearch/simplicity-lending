use std::num::TryFromIntError;

use simplex::{provider::ProviderError, simplicityhl::elements::Txid};

#[derive(thiserror::Error, Debug)]
pub enum LendingOfferError {
    #[error("Passed transaction is not a lending creation transaction")]
    NotALendingOfferCreationTx(Txid),

    #[error("Invalid creation OP_RETURN data length: expected - {expected}, actual - {actual}")]
    InvalidCreationMetadataLength { expected: usize, actual: usize },

    #[error("Invalid OP_RETURN borrower pubkey bytes: {0}")]
    InvalidMetadataBytes(String),

    #[error(transparent)]
    SimplexProvider(#[from] ProviderError),

    #[error("Failed to calculate interest rate: {0}")]
    TryFromInt(#[from] TryFromIntError),
}
