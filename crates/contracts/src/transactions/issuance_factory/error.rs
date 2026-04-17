use simplex::simplicityhl::elements::Txid;

use crate::programs::issuance_factory::IssuanceFactoryError;

#[derive(thiserror::Error, Debug)]
pub enum IssuanceFactoryTransactionError {
    #[error("Confidential assets currently are not supported")]
    ConfidentialAssetsAreNotSupported(),

    #[error("Passed transaction is not an issuance factory creation transaction")]
    NotAnIssuanceFactoryCreationTx(Txid),

    #[error("Failed to extract issuance factory parameters: {0}")]
    PreLock(#[from] IssuanceFactoryError),
}
