use lending_contracts::{
    programs::program::SimplexProgramError,
    transactions::{asset_auth::AssetAuthTransactionError, lending::LendingTransactionError},
};
use simplex::{
    provider::ProviderError,
    signer::SignerError,
    simplicityhl::{elements::Txid, simplicity::hex::HexToArrayError},
};

#[derive(thiserror::Error, Debug)]
pub enum LendingCommandError {
    #[error("Borrower NFT for the offer was not found: {0}")]
    NotABorrower(Txid),

    #[error("Lender NFT for the offer was not found: {0}")]
    NotALender(Txid),

    #[error(
        "The offer cannot be liquidated yet: needed height - {needed_height}, current height - {current_height}"
    )]
    LiquidationTimeHasNotComeYet {
        needed_height: u32,
        current_height: u32,
    },

    #[error(
        "Not enough principal assets to repay the loan: expected - {expected_amount}, actual - {actual_amount}"
    )]
    NotEnoughPrincipalToRepay {
        expected_amount: u64,
        actual_amount: u64,
    },

    #[error("Failed to build lending transaction: {0}")]
    LendingTransaction(#[from] LendingTransactionError),

    #[error("Failed to build asset auth transaction: {0}")]
    AssetAuthTransaction(#[from] AssetAuthTransactionError),

    #[error(transparent)]
    SimplexProgram(#[from] SimplexProgramError),

    #[error("Simplex Signer error: {0}")]
    Signer(#[from] SignerError),

    #[error("Simplex Provider error: {0}")]
    Provider(#[from] ProviderError),

    #[error("Hex to array error: {0}")]
    HexToArray(#[from] HexToArrayError),
}
