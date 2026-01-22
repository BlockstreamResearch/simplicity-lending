#![allow(clippy::similar_names)]

use anyhow::Result;

use clap::Subcommand;

use lending_contracts::sdk::parameters::LendingParameters;

use simplicityhl::elements::pset::serialize::Serialize;
use simplicityhl::elements::{Address, OutPoint};
use simplicityhl::simplicity::hex::DisplayHex;
use simplicityhl::tracker::TrackerLogLevel;

use simplicity_contracts::sdk::taproot_pubkey_gen::get_random_seed;
use simplicity_contracts_cli::explorer::{broadcast_tx, fetch_utxo};
use simplicity_contracts_cli::modules::utils::derive_keypair;

use simplicityhl_core::{create_p2pk_signature, finalize_p2pk_transaction};

use crate::commands::NETWORK;

/// Pre lock contract utilities
#[derive(Subcommand, Debug)]
pub enum PreLock {
    IssueUtilityNFTS {
        /// First issuance UTXO used to issue Borrower NFT asset UTXO
        #[arg(long = "first-issuance-utxo")]
        first_issuance_utxo: OutPoint,
        /// Second issuance UTXO used to issue Lender NFT asset UTXO
        #[arg(long = "second-issuance-utxo")]
        second_issuance_utxo: OutPoint,
        /// Third issuance UTXO used to issue First parameters NFT asset UTXO
        #[arg(long = "third-issuance-utxo")]
        third_issuance_utxo: OutPoint,
        /// Fourth issuance UTXO used to issue Second parameters NFT asset UTXO
        #[arg(long = "fourth-issuance-utxo")]
        fourth_issuance_utxo: OutPoint,
        /// Fee UTXO used to pay transaction fees
        #[arg(long = "fee-utxo")]
        fee_utxo: OutPoint,
        /// Recipient address (Liquid testnet bech32m)
        #[arg(long = "to-address")]
        to_address: Address,
        /// Collateral amount in satoshis
        #[arg(long = "collateral-amount")]
        collateral_amount: u64,
        /// Principal amount in satoshis
        #[arg(long = "principal-amount")]
        principal_amount: u64,
        /// Loan expiration time (block height)
        #[arg(long = "loan-expiration-time")]
        loan_expiration_time: u32,
        /// Principal interest rate (in basis points where 100% = `10_000`)
        #[arg(long = "principal-interest-rate")]
        principal_interest_rate: u16,
        /// Token decimals for amount conversion (from 0 to 15)
        #[arg(long = "tokens-decimals")]
        tokens_decimals: u8,
        /// Account index that will pay for transaction fees and owns the tokens to send
        #[arg(long = "account-index")]
        account_index: u32,
        /// Fee amount in satoshis (LBTC)
        #[arg(long = "fee-amount")]
        fee_amount: u64,
        /// When set, broadcast the built transaction via Esplora and print the transaction ID
        #[arg(long = "broadcast")]
        broadcast: bool,
    },
}

impl PreLock {
    /// Handle pre lock CLI subcommand execution.
    ///
    /// # Errors
    /// Returns an error if the subcommand operation fails.
    #[expect(clippy::too_many_lines)]
    pub async fn handle(&self) -> Result<()> {
        match self {
            Self::IssueUtilityNFTS {
                first_issuance_utxo,
                second_issuance_utxo,
                third_issuance_utxo,
                fourth_issuance_utxo,
                fee_utxo,
                to_address,
                collateral_amount,
                principal_amount,
                loan_expiration_time,
                principal_interest_rate,
                tokens_decimals,
                account_index,
                fee_amount,
                broadcast,
            } => {
                let keypair = derive_keypair(*account_index);

                let first_tx_out = fetch_utxo(*first_issuance_utxo).await?;
                let second_tx_out = fetch_utxo(*second_issuance_utxo).await?;
                let third_tx_out = fetch_utxo(*third_issuance_utxo).await?;
                let fourth_tx_out = fetch_utxo(*fourth_issuance_utxo).await?;
                let fee_tx_out = fetch_utxo(*fee_utxo).await?;

                let issuance_asset_entropy = get_random_seed();

                let lending_params = LendingParameters {
                    collateral_amount: *collateral_amount,
                    principal_amount: *principal_amount,
                    principal_interest_rate: *principal_interest_rate,
                    loan_expiration_time: *loan_expiration_time,
                };

                let pst = lending_contracts::sdk::build_utility_nfts_issuing(
                    (*first_issuance_utxo, first_tx_out.clone()),
                    (*second_issuance_utxo, second_tx_out.clone()),
                    (*third_issuance_utxo, third_tx_out.clone()),
                    (*fourth_issuance_utxo, fourth_tx_out.clone()),
                    (*fee_utxo, fee_tx_out.clone()),
                    &lending_params,
                    *tokens_decimals,
                    issuance_asset_entropy,
                    &to_address.script_pubkey(),
                    *fee_amount,
                )?;

                let tx = pst.extract_tx()?;
                let utxos = vec![
                    first_tx_out.clone(),
                    second_tx_out.clone(),
                    third_tx_out.clone(),
                    fourth_tx_out.clone(),
                    fee_tx_out.clone(),
                ];
                let x_only_public_key = keypair.x_only_public_key().0;

                let signature_0 = create_p2pk_signature(&tx, &utxos, &keypair, 0, NETWORK)?;
                let tx = finalize_p2pk_transaction(
                    tx,
                    &utxos,
                    &x_only_public_key,
                    &signature_0,
                    0,
                    NETWORK,
                    TrackerLogLevel::None,
                )?;

                let signature_1 = create_p2pk_signature(&tx, &utxos, &keypair, 1, NETWORK)?;
                let tx = finalize_p2pk_transaction(
                    tx,
                    &utxos,
                    &x_only_public_key,
                    &signature_1,
                    1,
                    NETWORK,
                    TrackerLogLevel::None,
                )?;

                let signature_2 = create_p2pk_signature(&tx, &utxos, &keypair, 2, NETWORK)?;
                let tx = finalize_p2pk_transaction(
                    tx,
                    &utxos,
                    &x_only_public_key,
                    &signature_2,
                    2,
                    NETWORK,
                    TrackerLogLevel::None,
                )?;

                let signature_3 = create_p2pk_signature(&tx, &utxos, &keypair, 3, NETWORK)?;
                let tx = finalize_p2pk_transaction(
                    tx,
                    &utxos,
                    &x_only_public_key,
                    &signature_3,
                    3,
                    NETWORK,
                    TrackerLogLevel::None,
                )?;

                let signature_4 = create_p2pk_signature(&tx, &utxos, &keypair, 4, NETWORK)?;
                let tx = finalize_p2pk_transaction(
                    tx,
                    &utxos,
                    &x_only_public_key,
                    &signature_4,
                    4,
                    NETWORK,
                    TrackerLogLevel::None,
                )?;

                if *broadcast {
                    println!("Broadcasted txid: {}", broadcast_tx(&tx).await?);
                } else {
                    println!("{}", tx.serialize().to_lower_hex_string());
                }

                Ok(())
            }
        }
    }
}
