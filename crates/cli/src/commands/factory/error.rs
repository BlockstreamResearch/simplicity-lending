use lending_contracts::programs::issuance_factory::IssuanceFactoryError;
use simplex::{provider::ProviderError, signer::SignerError};

#[derive(thiserror::Error, Debug)]
pub enum FactoryCommandError {
    #[error("Not a factory creation tx: {0}")]
    NotAFactoryCreationTx(#[from] IssuanceFactoryError),

    #[error("Factory program UTXO not found")]
    FactoryProgramUtxoNotFound,

    #[error("Auth NFT UTXO not found in signer wallet")]
    AuthNftUtxoNotFound,

    #[error("Simplex Signer error: {0}")]
    Signer(#[from] SignerError),

    #[error("Simplex Provider error: {0}")]
    Provider(#[from] ProviderError),
}
