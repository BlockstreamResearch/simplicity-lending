use lending_contracts::programs::issuance_factory::IssuanceFactoryError;
use simplex::provider::ProviderError;
use simplex::signer::SignerError;

use crate::indexer::IndexerClientError;

#[derive(thiserror::Error, Debug)]
pub enum SessionError {
    #[error("Invalid session state for this operation")]
    InvalidState,

    #[error("Borrower account already exists")]
    BorrowerAccountAlreadyExists,

    #[error("No policy UTXOs available")]
    NoPolicyUtxos,

    #[error("Factory program UTXO not found")]
    FactoryProgramUtxoNotFound,

    #[error("Auth NFT UTXO not found in wallet")]
    AuthNftUtxoNotFound,

    #[error(transparent)]
    Indexer(#[from] IndexerClientError),

    #[error(transparent)]
    Signer(#[from] SignerError),

    #[error(transparent)]
    Provider(#[from] ProviderError),

    #[error(transparent)]
    Factory(#[from] IssuanceFactoryError),
}
