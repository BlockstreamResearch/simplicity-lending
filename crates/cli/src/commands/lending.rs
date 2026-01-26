#![allow(clippy::similar_names)]

use anyhow::Result;

use clap::Subcommand;

use lending_contracts::lending::build_arguments::LendingArguments;
use lending_contracts::lending::build_witness::LendingBranch;
use lending_contracts::lending::{finalize_lending_transaction, get_lending_program};
use lending_contracts::script_auth::build_arguments::ScriptAuthArguments;
use lending_contracts::script_auth::build_witness::ScriptAuthWitnessParams;
use lending_contracts::script_auth::{finalize_script_auth_transaction, get_script_auth_program};

use lending_contracts::sdk::taproot_unspendable_internal_key;
use simplicityhl::elements::hashes::sha256;
use simplicityhl::elements::pset::serialize::Serialize;
use simplicityhl::elements::{Address, OutPoint};
use simplicityhl::simplicity::ToXOnlyPubkey;
use simplicityhl::simplicity::hex::DisplayHex;
use simplicityhl::tracker::TrackerLogLevel;

use simplicity_contracts_cli::explorer::{broadcast_tx, fetch_utxo};
use simplicity_contracts_cli::modules::store::Store;
use simplicity_contracts_cli::modules::utils::derive_keypair;

use simplicityhl_core::{create_p2pk_signature, finalize_p2pk_transaction};

use crate::commands::NETWORK;

/// Lending contract utilities
#[derive(Subcommand, Debug)]
pub enum Lending {
    Repay {
        /// UTXO with the lending covenant script
        #[arg(long = "lending-utxo")]
        lending_utxo: OutPoint,
        /// UTXO with the principal asset
        #[arg(long = "principal-utxo")]
        principal_utxo: OutPoint,
        /// First parameters NFT UTXO
        #[arg(long = "first-parameters-nft-utxo")]
        first_parameters_nft_utxo: OutPoint,
        /// Second parameters NFT UTXO
        #[arg(long = "second-parameters-nft-utxo")]
        second_parameters_nft_utxo: OutPoint,
        /// Borrower NFT UTXO
        #[arg(long = "borrower-nft-utxo")]
        borrower_nft_utxo: OutPoint,
        /// Fee UTXO used to pay transaction fees
        #[arg(long = "fee-utxo")]
        fee_utxo: OutPoint,
        /// Lending covenant hash that in this CLI works as unique contract identifier
        #[arg(long = "lending-cov-hash")]
        lending_cov_hash: String,
        /// Recipient address (Liquid testnet bech32m)
        #[arg(long = "to-address")]
        to_address: Address,
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
    Liquidate {
        /// UTXO with the lending covenant script
        #[arg(long = "lending-utxo")]
        lending_utxo: OutPoint,
        /// First parameters NFT UTXO
        #[arg(long = "first-parameters-nft-utxo")]
        first_parameters_nft_utxo: OutPoint,
        /// Second parameters NFT UTXO
        #[arg(long = "second-parameters-nft-utxo")]
        second_parameters_nft_utxo: OutPoint,
        /// Lender NFT UTXO
        #[arg(long = "lender-nft-utxo")]
        lender_nft_utxo: OutPoint,
        /// Fee UTXO used to pay transaction fees
        #[arg(long = "fee-utxo")]
        fee_utxo: OutPoint,
        /// Lending covenant hash that in this CLI works as unique contract identifier
        #[arg(long = "lending-cov-hash")]
        lending_cov_hash: String,
        /// Recipient address (Liquid testnet bech32m)
        #[arg(long = "to-address")]
        to_address: Address,
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

impl Lending {
    /// Handle lending CLI subcommand execution.
    ///
    /// # Errors
    /// Returns an error if the subcommand operation fails.
    #[expect(clippy::too_many_lines)]
    pub async fn handle(&self) -> Result<()> {
        match self {
            Self::Repay {
                lending_utxo,
                principal_utxo,
                first_parameters_nft_utxo,
                second_parameters_nft_utxo,
                borrower_nft_utxo,
                fee_utxo,
                lending_cov_hash,
                to_address,
                account_index,
                fee_amount,
                broadcast,
            } => {
                let store = Store::load()?;
                let keypair = derive_keypair(*account_index);
                let x_only_public_key = keypair.x_only_public_key().0;

                let lending_arguments: LendingArguments = store.get_arguments(lending_cov_hash)?;

                let lending_tx_out = fetch_utxo(*lending_utxo).await?;
                let principal_tx_out = fetch_utxo(*principal_utxo).await?;
                let first_parameters_nft_tx_out = fetch_utxo(*first_parameters_nft_utxo).await?;
                let second_parameters_nft_tx_out = fetch_utxo(*second_parameters_nft_utxo).await?;
                let borrower_nft_tx_out = fetch_utxo(*borrower_nft_utxo).await?;
                let fee_tx_out = fetch_utxo(*fee_utxo).await?;

                let pst = lending_contracts::sdk::build_lending_loan_repayment(
                    (*lending_utxo, lending_tx_out.clone()),
                    (*principal_utxo, principal_tx_out.clone()),
                    (
                        *first_parameters_nft_utxo,
                        first_parameters_nft_tx_out.clone(),
                    ),
                    (
                        *second_parameters_nft_utxo,
                        second_parameters_nft_tx_out.clone(),
                    ),
                    (*borrower_nft_utxo, borrower_nft_tx_out.clone()),
                    (*fee_utxo, fee_tx_out.clone()),
                    &lending_arguments,
                    &to_address.script_pubkey(),
                    *fee_amount,
                    NETWORK,
                )?;

                let tx = pst.extract_tx()?;
                let utxos = vec![
                    lending_tx_out.clone(),
                    first_parameters_nft_tx_out.clone(),
                    second_parameters_nft_tx_out.clone(),
                    borrower_nft_tx_out.clone(),
                    principal_tx_out.clone(),
                    fee_tx_out.clone(),
                ];

                let lending_program = get_lending_program(&lending_arguments)?;
                let unspendable_x_only_public_key =
                    taproot_unspendable_internal_key().to_x_only_pubkey();

                let tx = finalize_lending_transaction(
                    tx,
                    &unspendable_x_only_public_key,
                    &lending_program,
                    &utxos,
                    0,
                    LendingBranch::LoanRepayment,
                    NETWORK,
                    TrackerLogLevel::None,
                )?;

                let script_auth_arguments = ScriptAuthArguments::new(
                    sha256::Midstate::from_slice(lending_cov_hash.as_bytes())?.0,
                );
                let script_auth_program = get_script_auth_program(&script_auth_arguments)?;
                let script_auth_witness_params = ScriptAuthWitnessParams {
                    input_script_index: 0,
                };

                let tx = finalize_script_auth_transaction(
                    tx,
                    &unspendable_x_only_public_key,
                    &script_auth_program,
                    &utxos,
                    1,
                    &script_auth_witness_params,
                    NETWORK,
                    TrackerLogLevel::None,
                )?;

                let tx = finalize_script_auth_transaction(
                    tx,
                    &unspendable_x_only_public_key,
                    &script_auth_program,
                    &utxos,
                    2,
                    &script_auth_witness_params,
                    NETWORK,
                    TrackerLogLevel::None,
                )?;

                let signature_0 = create_p2pk_signature(&tx, &utxos, &keypair, 3, NETWORK)?;
                let tx = finalize_p2pk_transaction(
                    tx,
                    &utxos,
                    &x_only_public_key,
                    &signature_0,
                    3,
                    NETWORK,
                    TrackerLogLevel::None,
                )?;

                let signature_1 = create_p2pk_signature(&tx, &utxos, &keypair, 4, NETWORK)?;
                let tx = finalize_p2pk_transaction(
                    tx,
                    &utxos,
                    &x_only_public_key,
                    &signature_1,
                    4,
                    NETWORK,
                    TrackerLogLevel::None,
                )?;

                let signature_2 = create_p2pk_signature(&tx, &utxos, &keypair, 5, NETWORK)?;
                let tx = finalize_p2pk_transaction(
                    tx,
                    &utxos,
                    &x_only_public_key,
                    &signature_2,
                    5,
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
            Self::Liquidate {
                lending_utxo,
                first_parameters_nft_utxo,
                second_parameters_nft_utxo,
                lender_nft_utxo,
                fee_utxo,
                lending_cov_hash,
                to_address,
                account_index,
                fee_amount,
                broadcast,
            } => {
                let store = Store::load()?;
                let keypair = derive_keypair(*account_index);
                let x_only_public_key = keypair.x_only_public_key().0;

                let lending_arguments: LendingArguments = store.get_arguments(lending_cov_hash)?;

                let lending_tx_out = fetch_utxo(*lending_utxo).await?;
                let first_parameters_nft_tx_out = fetch_utxo(*first_parameters_nft_utxo).await?;
                let second_parameters_nft_tx_out = fetch_utxo(*second_parameters_nft_utxo).await?;
                let lender_nft_tx_out = fetch_utxo(*lender_nft_utxo).await?;
                let fee_tx_out = fetch_utxo(*fee_utxo).await?;

                let pst = lending_contracts::sdk::build_lending_loan_liquidation(
                    (*lending_utxo, lending_tx_out.clone()),
                    (
                        *first_parameters_nft_utxo,
                        first_parameters_nft_tx_out.clone(),
                    ),
                    (
                        *second_parameters_nft_utxo,
                        second_parameters_nft_tx_out.clone(),
                    ),
                    (*lender_nft_utxo, lender_nft_tx_out.clone()),
                    (*fee_utxo, fee_tx_out.clone()),
                    &lending_arguments,
                    &to_address.script_pubkey(),
                    *fee_amount,
                )?;

                let tx = pst.extract_tx()?;
                let utxos = vec![
                    lending_tx_out.clone(),
                    first_parameters_nft_tx_out.clone(),
                    second_parameters_nft_tx_out.clone(),
                    lender_nft_tx_out.clone(),
                    fee_tx_out.clone(),
                ];

                let lending_program = get_lending_program(&lending_arguments)?;
                let unspendable_x_only_public_key =
                    taproot_unspendable_internal_key().to_x_only_pubkey();

                let tx = finalize_lending_transaction(
                    tx,
                    &unspendable_x_only_public_key,
                    &lending_program,
                    &utxos,
                    0,
                    LendingBranch::LoanLiquidation,
                    NETWORK,
                    TrackerLogLevel::None,
                )?;

                let script_auth_arguments = ScriptAuthArguments::new(
                    sha256::Midstate::from_slice(lending_cov_hash.as_bytes())?.0,
                );
                let script_auth_program = get_script_auth_program(&script_auth_arguments)?;
                let script_auth_witness_params = ScriptAuthWitnessParams {
                    input_script_index: 0,
                };

                let tx = finalize_script_auth_transaction(
                    tx,
                    &unspendable_x_only_public_key,
                    &script_auth_program,
                    &utxos,
                    1,
                    &script_auth_witness_params,
                    NETWORK,
                    TrackerLogLevel::None,
                )?;

                let tx = finalize_script_auth_transaction(
                    tx,
                    &unspendable_x_only_public_key,
                    &script_auth_program,
                    &utxos,
                    2,
                    &script_auth_witness_params,
                    NETWORK,
                    TrackerLogLevel::None,
                )?;

                let signature_0 = create_p2pk_signature(&tx, &utxos, &keypair, 3, NETWORK)?;
                let tx = finalize_p2pk_transaction(
                    tx,
                    &utxos,
                    &x_only_public_key,
                    &signature_0,
                    3,
                    NETWORK,
                    TrackerLogLevel::None,
                )?;

                let signature_1 = create_p2pk_signature(&tx, &utxos, &keypair, 4, NETWORK)?;
                let tx = finalize_p2pk_transaction(
                    tx,
                    &utxos,
                    &x_only_public_key,
                    &signature_1,
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
