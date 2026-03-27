use simplex::{simplicityhl::elements::Txid, transaction::TransactionError};

use crate::programs::{PreLockError, program::SimplexProgramError};

#[derive(thiserror::Error, Debug)]
pub enum PreLockTransactionError {
    #[error("Confidential assets currently are not supported")]
    ConfidentialAssetsAreNotSupported(),

    #[error("Passed transaction is not a pre lock creation transaction")]
    NotAPreLockCreationTx(Txid),

    #[error("Failed to extract pre lock parameters: {0}")]
    PreLock(#[from] PreLockError),

    #[error(transparent)]
    SimplexProgram(#[from] SimplexProgramError),

    #[error(transparent)]
    SimplexTransaction(#[from] TransactionError),
}
