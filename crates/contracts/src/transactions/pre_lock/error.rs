use simplex::{provider::ProviderError, simplicityhl::elements::Txid};

#[derive(thiserror::Error, Debug)]
pub enum PreLockTransactionError {
    #[error("Confidential assets currently are not supported")]
    ConfidentialAssetsAreNotSupported(),

    #[error("Passed transaction is not a pre lock creation transaction")]
    NotAPreLockCreationTx(Txid),

    #[error(transparent)]
    SimplexProvider(#[from] ProviderError),
}
