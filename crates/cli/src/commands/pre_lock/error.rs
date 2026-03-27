use lending_contracts::{
    programs::program::SimplexProgramError, transactions::pre_lock::PreLockTransactionError,
};
use simplex::{
    provider::ProviderError, signer::SignerError, simplicityhl::simplicity::hex::HexToArrayError,
};

#[derive(thiserror::Error, Debug)]
pub enum PreLockCommandError {
    #[error("No collateral utxos found for the {0} collateral amount")]
    NoCollateralUTXOsFound(u64),

    #[error("No suitable principal utxos found for the {0} principal amount")]
    NoSuitablePrincipalUTXOsFound(u64),

    #[error("Failed to build pre lock transaction: {0}")]
    PreLockTransaction(#[from] PreLockTransactionError),

    #[error(transparent)]
    SimplexProgram(#[from] SimplexProgramError),

    #[error("Simplex Signer error: {0}")]
    Signer(#[from] SignerError),

    #[error("Simplex Provider error: {0}")]
    Provider(#[from] ProviderError),

    #[error("Hex to array error: {0}")]
    HexToArray(#[from] HexToArrayError),
}
