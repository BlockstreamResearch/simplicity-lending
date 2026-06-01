use simplex::{
    provider::ProviderError,
    signer::SignerError,
    simplicityhl::{
        elements::OutPoint,
        simplicity::{bitcoin::key::ParsePublicKeyError, hex::HexToArrayError},
    },
};

#[derive(thiserror::Error, Debug)]
pub enum AccountCommandError {
    #[error("Not a signer utxo: {0}")]
    NotASignerUTXO(OutPoint),

    #[error("Duplicate outpoint in merge input: {0}")]
    DuplicateOutpoint(OutPoint),

    #[error("At least one outpoint is required for merge-utxo")]
    MissingOutpointsToMerge,

    #[error(
        "All merged UTXOs must have the same asset. Expected {expected_asset_id}, but {outpoint} has {actual_asset_id}"
    )]
    UTXOsAssetMismatch {
        expected_asset_id: String,
        actual_asset_id: String,
        outpoint: OutPoint,
    },

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

    #[error("Hex to array error: {0}")]
    HexToArray(#[from] HexToArrayError),

    #[error("Invalid recipient blinding public key `{key}`: {source}")]
    InvalidRecipientBlindingPublicKey {
        key: String,
        source: ParsePublicKeyError,
    },
}
