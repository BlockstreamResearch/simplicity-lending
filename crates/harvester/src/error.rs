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
}
