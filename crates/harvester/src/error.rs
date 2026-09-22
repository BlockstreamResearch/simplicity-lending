use lending_indexer::client::IndexerClientError;

#[derive(thiserror::Error, Debug)]
pub enum HarvesterError {
    #[error("configuration error: {0}")]
    Config(#[from] config::ConfigError),

    #[error(transparent)]
    Indexer(#[from] IndexerClientError),

    #[error("invalid protocol-fee vault amount `{amount}` for offer {offer_id}")]
    InvalidAmount { offer_id: String, amount: String },
}
