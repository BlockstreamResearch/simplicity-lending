use simplex::{
    provider::ProviderError,
    signer::SignerError,
    simplicityhl::{elements::OutPoint, simplicity::hex::HexToArrayError},
    transaction::TransactionError,
};

#[derive(thiserror::Error, Debug)]
pub enum AccountCommandError {
    #[error("Not a signer utxo: {0}")]
    NotASignerUTXO(OutPoint),

    #[error(
        "Not enough {asset_id} asset to send: needed amount - {needed_amount}, actual amount - {actual_amount}"
    )]
    NotEnoughAsset {
        asset_id: String,
        needed_amount: u64,
        actual_amount: u64,
    },

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

    #[error("Hex to array error: {0}")]
    HexToArray(#[from] HexToArrayError),
}
