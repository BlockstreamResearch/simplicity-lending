use lending_indexer::client::IndexerClientError;

#[derive(thiserror::Error, Debug)]
pub enum HarvesterError {
    #[error("configuration error: {0}")]
    Config(#[from] config::ConfigError),

    #[error(transparent)]
    Indexer(#[from] IndexerClientError),

    #[error("invalid protocol-fee vault amount `{amount}` for offer {offer_id}")]
    InvalidAmount { offer_id: String, amount: String },

    #[error("failed to access collector state at {path}: {source}")]
    StateIo {
        path: std::path::PathBuf,
        #[source]
        source: std::io::Error,
    },

    #[error("invalid collector state at {path}: {source}")]
    InvalidState {
        path: std::path::PathBuf,
        #[source]
        source: serde_json::Error,
    },

    #[error("invalid `{field}` value `{value}` in configuration")]
    InvalidSetting { field: &'static str, value: String },

    #[error("fee collector is already bootstrapped; state already exists at {path}")]
    AlreadyBootstrapped { path: std::path::PathBuf },

    #[error("fee collector is not bootstrapped; state is absent at {path}")]
    NotBootstrapped { path: std::path::PathBuf },

    #[error("withdraw destination address is not set")]
    MissingDestination,

    #[error("invalid destination address `{address}`")]
    InvalidAddress { address: String },

    #[error(
        "no principal-asset ({principal_asset}) funds in the harvest wallet to bootstrap the fee collector"
    )]
    NoBootstrapFunds { principal_asset: String },

    #[error("amount overflows u64")]
    AmountOverflow,

    #[error("invalid txid `{txid}`")]
    InvalidTxid { txid: String },

    #[error("invalid protocol-fee vault `{field}` `{value}` for offer {offer_id}")]
    InvalidVaultField {
        offer_id: String,
        field: &'static str,
        value: String,
    },

    #[error("collector UTXO {outpoint} was not found")]
    MissingCollectorUtxo { outpoint: String },

    #[error("transaction {txid} has {count} fee collector outputs")]
    CollectorOutputs { txid: String, count: usize },

    #[error("protocol-fee vault {outpoint} for offer {offer_id} was not found")]
    MissingVaultUtxo { offer_id: String, outpoint: String },

    #[error("harvest wallet has no unused keeper UTXO ({asset}) for offer {offer_id}")]
    MissingKeeperUtxo { offer_id: String, asset: String },

    #[error(
        "protocol-fee vault {outpoint} for offer {offer_id} holds {on_chain}, indexer reports {indexed}"
    )]
    VaultAmountMismatch {
        offer_id: String,
        outpoint: String,
        on_chain: u64,
        indexed: u64,
    },

    #[error(transparent)]
    Signer(#[from] simplex::signer::SignerError),

    #[error(transparent)]
    Provider(#[from] simplex::provider::ProviderError),
}
