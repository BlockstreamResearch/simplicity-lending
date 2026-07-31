use simplex::provider::ProviderError;
use simplex::signer::SignerError;

use lending_contracts::programs::issuance_factory::IssuanceFactoryError;

use crate::indexer::IndexerClientError;

#[derive(thiserror::Error, Debug)]
pub enum SessionError {
    #[error("Invalid session state for this operation")]
    InvalidState,

    #[error("Borrower account already exists")]
    BorrowerAccountAlreadyExists,

    #[error("No policy UTXOs available")]
    NoPolicyUtxos,

    #[error("Factory not found")]
    FactoryNotFound,

    #[error("Factory program UTXO not found")]
    FactoryProgramUtxoNotFound,

    #[error("Auth NFT UTXO not found in wallet")]
    AuthNftUtxoNotFound,

    #[error("Collateral UTXOs with sufficient amount not found in wallet")]
    CollateralUtxoNotFound,

    #[error("Offer is not pending")]
    OfferNotPending,

    #[error("Offer is not active")]
    OfferNotActive,

    #[error("Pending offer UTXO not found")]
    PendingOfferUtxoNotFound,

    #[error("Active offer UTXO not found")]
    ActiveOfferUtxoNotFound,

    #[error("Loan expiration time has not been reached yet")]
    LoanNotExpired,

    #[error("Lender NFT UTXO not found")]
    LenderNftUtxoNotFound,

    #[error("Borrower NFT UTXO not found in wallet")]
    BorrowerNftUtxoNotFound,

    #[error("Principal UTXOs with sufficient amount not found in wallet")]
    PrincipalUtxoNotFound,

    #[error("Borrower principal UTXO not found")]
    BorrowerPrincipalUtxoNotFound,

    #[error("Indexer returned invalid `{field}` value for offer: {value}")]
    InvalidOfferData { field: &'static str, value: String },

    #[error(transparent)]
    Indexer(#[from] IndexerClientError),

    #[error(transparent)]
    Signer(#[from] SignerError),

    #[error(transparent)]
    Provider(#[from] ProviderError),

    #[error(transparent)]
    Factory(#[from] IssuanceFactoryError),
}
