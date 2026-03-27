use simplex::transaction::TransactionError;

use crate::programs::program::SimplexProgramError;

#[derive(thiserror::Error, Debug)]
pub enum LendingTransactionError {
    #[error("Not enough principal assets to repay: expected - {expected}, actual - {actual}")]
    NotEnoughPrincipalToRepay { expected: u64, actual: u64 },

    #[error("Failed to convert loan expiration time to LockTime: {0}")]
    InvalidLockHeight(u32),

    #[error(transparent)]
    SimplexProgram(#[from] SimplexProgramError),

    #[error(transparent)]
    SimplexTransaction(#[from] TransactionError),
}
