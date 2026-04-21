use simplex::simplicityhl::elements::Txid;

#[derive(thiserror::Error, Debug)]
pub enum IssuanceFactoryError {
    #[error("Invalid creation OP_RETURN data length: expected - {expected}, actual - {actual}")]
    InvalidCreationOpReturnDataLength { expected: usize, actual: usize },

    #[error("Invalid OP_RETURN owner pubkey bytes: {0}")]
    InvalidOpReturnBytes(String),

    #[error("Confidential assets currently are not supported")]
    ConfidentialAssetsAreNotSupported(),

    #[error("Passed transaction is not an issuance factory creation transaction")]
    NotAnIssuanceFactoryCreationTx(Txid),
}
