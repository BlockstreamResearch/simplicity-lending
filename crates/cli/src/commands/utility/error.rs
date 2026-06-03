#[derive(thiserror::Error, Debug)]
pub enum UtilityCommandError {
    #[error("Invalid entropy hex `{entropy}`: {source}")]
    InvalidEntropyHex {
        entropy: String,
        source: hex::FromHexError,
    },

    #[error("Entropy must be exactly 32 bytes (64 hex chars), got {actual_bytes} bytes")]
    InvalidEntropyLength { actual_bytes: usize },
}
