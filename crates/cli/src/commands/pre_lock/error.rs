use lending_contracts::programs::pre_lock::PreLockError;
use simplex::{
    provider::ProviderError, signer::SignerError, simplicityhl::simplicity::hex::HexToArrayError,
};

#[derive(thiserror::Error, Debug)]
pub enum PreLockCommandError {
    #[error("No collateral utxos found for the {0} collateral amount")]
    NoCollateralUTXOsFound(u64),

    #[error("No suitable principal utxos found for the {0} principal amount")]
    NoSuitablePrincipalUTXOsFound(u64),

    #[error(
        "Not enough principal assets to accept the offer: expected - {expected_amount}, actual - {actual_amount}"
    )]
    NotEnoughPrincipalToAcceptOffer {
        expected_amount: u64,
        actual_amount: u64,
    },

    #[error("PreLock error: {0}")]
    PreLock(#[from] PreLockError),

    #[error("Simplex Signer error: {0}")]
    Signer(#[from] SignerError),

    #[error("Simplex Provider error: {0}")]
    Provider(#[from] ProviderError),

    #[error("Hex to array error: {0}")]
    HexToArray(#[from] HexToArrayError),
}
