use simplicity_contracts::error::{TaprootPubkeyGenError, ValidationError};

#[derive(Debug, thiserror::Error)]
pub enum ParametersError {
    #[error("Invalid collateral amount: expected {expected}, got {actual}")]
    InvalidCollateralAmount { expected: String, actual: String },

    #[error("Invalid principal amount: expected {expected}, got {actual}")]
    InvalidPrincipalAmount { expected: String, actual: String },

    #[error("Invalid interest rate: expected {expected}, got {actual}")]
    InvalidInterestRate { expected: String, actual: String },

    #[error("Invalid loan expiration time: expected {expected}, got {actual}")]
    InvalidLoanExpirationTime { expected: String, actual: String },
}

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
    #[error("Invalid script: expected {expected}, got {actual}")]
    InvalidScript { expected: String, actual: String },

    #[error("Invalid asset id: expected {expected}, got {actual}")]
    InvalidAssetId { expected: String, actual: String },

    #[error("Invalid asset value: expected {expected}, got {actual}")]
    InvalidAssetValue { expected: String, actual: String },

    #[error("Failed to blind transaction: {0}")]
    Blinding(#[from] simplicityhl::elements::pset::Error),

    #[error("Failed to blind transaction outputs: {0}")]
    BlindingOutputs(#[from] simplicityhl::elements::pset::PsetBlindError),

    #[error("Transaction amount proof verification failed: {0}")]
    AmountProofVerification(#[from] simplicityhl::elements::VerificationError),

    #[error("Invalid lock time: {0}")]
    InvalidLockTime(#[from] simplicityhl::elements::locktime::Error),

    #[error(transparent)]
    Parameters(#[from] ParametersError),

    #[error(transparent)]
    AssetAuth(#[from] AssetAuthError),

    #[error(transparent)]
    ScriptAuth(#[from] ScriptAuthError),

    #[error(transparent)]
    Validation(#[from] ValidationError),

    #[error(transparent)]
    TaprootPubkeyGen(#[from] TaprootPubkeyGenError),
}
