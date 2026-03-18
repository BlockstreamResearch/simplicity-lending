use simplex::transaction::TransactionError;

use crate::programs::program::SimplexProgramError;

#[derive(thiserror::Error, Debug)]
pub enum ScriptAuthTransactionError {
    #[error("Passed input had invalid asset id")]
    InvalidAssetId(),

    #[error("Passed input had invalid asset amount")]
    InvalidAssetAmount(),

    #[error(transparent)]
    SimplexProgram(#[from] SimplexProgramError),

    #[error(transparent)]
    SimplexTransaction(#[from] TransactionError),
}
