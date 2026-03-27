use simplex::{
    provider::ProviderError, signer::SignerError, simplicityhl::elements::OutPoint,
    transaction::TransactionError,
};

#[derive(thiserror::Error, Debug)]
pub enum AccountCommandError {
    #[error("Not a signer utxo: {0}")]
    NotASignerUTXO(OutPoint),

    #[error(
        "Split amounts exceed the UTXO amount: UTXO amount = {utxo_amount}, total split amount = {total_amount_to_split}"
    )]
    AmountsToSplitTooLarge {
        utxo_amount: u64,
        total_amount_to_split: u64,
    },

    #[error("Simplex Signer error: {0}")]
    Signer(#[from] SignerError),

    #[error("Simplex Provider error: {0}")]
    Provider(#[from] ProviderError),

    #[error("Simplex Transaction error: {0}")]
    Transaction(#[from] TransactionError),
}
