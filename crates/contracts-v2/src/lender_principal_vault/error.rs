#[derive(thiserror::Error, Debug, Clone, Copy, PartialEq, Eq)]
pub enum LenderPrincipalVaultError {
    #[error("The vault UTXO must hold an explicit amount")]
    ConfidentialVaultUtxo,

    #[error("The vault accounting does not fit in u64")]
    AccountingOverflow,

    #[error("Withdrawing {amount} exceeds the vault balance of {balance}")]
    InsufficientBalance { amount: u64, balance: u64 },
}
