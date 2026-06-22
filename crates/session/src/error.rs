#[derive(thiserror::Error, Debug)]
pub enum SessionError {
    #[error("Invalid session state for this operation")]
    InvalidState,
}
