use simplicity_contracts::error::{TaprootPubkeyGenError, ValidationError};

#[derive(Debug, thiserror::Error)]
pub enum AssetAuthError {
    #[error("Invalid auth UTXO asset id: expected {expected}, got {actual}")]
    InvalidAuthAssetId { expected: String, actual: String },
}

#[derive(Debug, thiserror::Error)]
pub enum ScriptAuthError {
    #[error("Invalid auth UTXO script hash: expected {expected}, got {actual}")]
    InvalidAuthScriptHash { expected: String, actual: String },
}

/// Errors from transaction building operations.
#[derive(Debug, thiserror::Error)]
pub enum TransactionBuildError {
    #[error("Failed to blind transaction: {0}")]
    Blinding(#[from] simplicityhl::elements::pset::Error),

    #[error("Failed to blind transaction outputs: {0}")]
    BlindingOutputs(#[from] simplicityhl::elements::pset::PsetBlindError),

    #[error("Transaction amount proof verification failed: {0}")]
    AmountProofVerification(#[from] simplicityhl::elements::VerificationError),

    #[error("Invalid lock time: {0}")]
    InvalidLockTime(#[from] simplicityhl::elements::locktime::Error),

    #[error(transparent)]
    AssetAuth(#[from] AssetAuthError),

    #[error(transparent)]
    ScriptAuth(#[from] ScriptAuthError),

    #[error(transparent)]
    Validation(#[from] ValidationError),

    #[error(transparent)]
    TaprootPubkeyGen(#[from] TaprootPubkeyGenError),
}
