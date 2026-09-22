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

    #[error(
        "no principal-asset ({principal_asset}) funds in the harvest wallet to bootstrap the fee collector"
    )]
    NoBootstrapFunds { principal_asset: String },

    #[error("total bootstrap amount overflows u64")]
    AmountOverflow,

    #[error(transparent)]
    Signer(#[from] simplex::signer::SignerError),
}
