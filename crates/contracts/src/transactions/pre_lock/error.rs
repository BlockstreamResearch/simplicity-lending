use simplex::simplex_sdk::transaction::TransactionError;

use crate::programs::program::SimplexProgramError;

#[derive(thiserror::Error, Debug)]
pub enum PreLockTransactionError {
    #[error(transparent)]
    SimplexProgram(#[from] SimplexProgramError),

    #[error(transparent)]
    SimplexTransaction(#[from] TransactionError),
}
