use simplex::simplicityhl::elements::Txid;

#[derive(thiserror::Error, Debug)]
pub enum LendingError {
    #[error("Confidential assets currently are not supported")]
    ConfidentialAssetsAreNotSupported(),

    #[error("Passed transaction is not a lending creation transaction")]
    NotALendingCreationTx(Txid),
}
