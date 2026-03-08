use simplicity_contracts::error::{TaprootPubkeyGenError, ValidationError};
use simplicityhl_core::ProgramError;

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

    #[error("Out of bounds error: {actual_error}")]
    ValueOutOfBounds { actual_error: String },
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

#[derive(Debug, thiserror::Error)]
pub enum PreLockError {
    #[error("Not a pre lock transaction: txid - {txid}")]
    NotAPreLockTransaction { txid: String },
    #[error("Invalid OP_RETURN metadata bytes: {bytes}")]
    InvalidOpReturnBytes { bytes: String },
    #[error(
        "Pre lock borrower output script hashes differ: borrower NFT {borrower_nft_output_script_hash}, principal {principal_output_script_hash}"
    )]
    InconsistentBorrowerOutputScriptHashes {
        borrower_nft_output_script_hash: String,
        principal_output_script_hash: String,
    },
    #[error("Borrower output script hash mismatch: expected {expected_hash}, actual {actual_hash}")]
    BorrowerOutputScriptHashMismatch {
        expected_hash: String,
        actual_hash: String,
    },
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
    PreLock(#[from] PreLockError),

    #[error(transparent)]
    Validation(#[from] ValidationError),

    #[error(transparent)]
    TaprootPubkeyGen(#[from] TaprootPubkeyGenError),

    #[error(transparent)]
    Program(#[from] ProgramError),
}
