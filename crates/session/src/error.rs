use crate::indexer::IndexerClientError;

#[derive(thiserror::Error, Debug)]
pub enum SessionError {
    #[error("Invalid session state for this operation")]
    InvalidState,

    #[error(transparent)]
    Indexer(#[from] IndexerClientError),
}
