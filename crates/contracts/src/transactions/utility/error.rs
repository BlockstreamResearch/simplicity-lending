use simplex::transaction::TransactionError;

use crate::{error::ParametersError, programs::program::SimplexProgramError};

#[derive(thiserror::Error, Debug)]
pub enum UtilityTransactionError {
    #[error("Invalid issuance inputs count: expected - {expected_count}, actual - {actual_count}")]
    InvalidIssuanceInputsCount {
        expected_count: usize,
        actual_count: usize,
    },

    #[error(transparent)]
    OfferParameters(#[from] ParametersError),

    #[error(transparent)]
    SimplexProgram(#[from] SimplexProgramError),

    #[error(transparent)]
    SimplexTransaction(#[from] TransactionError),
}
