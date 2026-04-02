use simplex::{provider::ProviderError, simplicityhl::elements::Txid};

use crate::programs::PreLockError;

#[derive(thiserror::Error, Debug)]
pub enum PreLockTransactionError {
    #[error("Confidential assets currently are not supported")]
    ConfidentialAssetsAreNotSupported(),

    #[error("Passed transaction is not a pre lock creation transaction")]
    NotAPreLockCreationTx(Txid),

    #[error("Failed to extract pre lock parameters: {0}")]
    PreLock(#[from] PreLockError),

    #[error(transparent)]
    SimplexProvider(#[from] ProviderError),
}
