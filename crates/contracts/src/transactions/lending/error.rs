use simplex::{simplicityhl::elements::Txid, transaction::TransactionError};

use crate::programs::program::SimplexProgramError;

#[derive(thiserror::Error, Debug)]
pub enum LendingTransactionError {
    #[error("Confidential assets currently are not supported")]
    ConfidentialAssetsAreNotSupported(),

    #[error("Not enough principal assets to repay: expected - {expected}, actual - {actual}")]
    NotEnoughPrincipalToRepay { expected: u64, actual: u64 },

    #[error("Passed transaction is not a lending creation transaction")]
    NotALendingCreationTx(Txid),

    #[error("Failed to convert loan expiration time to LockTime: {0}")]
    InvalidLockHeight(u32),

    #[error(transparent)]
    SimplexProgram(#[from] SimplexProgramError),

    #[error(transparent)]
    SimplexTransaction(#[from] TransactionError),
}
