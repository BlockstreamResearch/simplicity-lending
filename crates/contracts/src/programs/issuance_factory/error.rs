use simplex::simplicityhl::elements::Txid;

#[derive(thiserror::Error, Debug)]
pub enum IssuanceFactoryError {
    #[error("Invalid creation OP_RETURN data length: expected - {expected}, actual - {actual}")]
    InvalidCreationMetadataLength { expected: usize, actual: usize },

    #[error("Invalid OP_RETURN metadata bytes: {0}")]
    InvalidMetadataBytes(String),

    #[error("Passed transaction is not an issuance factory creation transaction")]
    NotAnIssuanceFactoryCreationTx(Txid),
}
