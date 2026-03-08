#![allow(clippy::similar_names)]

use std::str::FromStr;

use anyhow::Result;

use clap::Subcommand;

use lending_contracts::asset_auth::build_arguments::AssetAuthArguments;
use lending_contracts::asset_auth::get_asset_auth_address;
use lending_contracts::lending::build_arguments::LendingArguments;
use lending_contracts::lending::get_lending_address;
use lending_contracts::pre_lock::build_arguments::PreLockArguments;
use lending_contracts::pre_lock::build_witness::PreLockBranch;
use lending_contracts::pre_lock::{
    finalize_pre_lock_transaction, get_pre_lock_address, get_pre_lock_program,
};
use lending_contracts::script_auth::build_arguments::ScriptAuthArguments;
use lending_contracts::script_auth::build_witness::ScriptAuthWitnessParams;
use lending_contracts::script_auth::{
    finalize_script_auth_transaction, get_script_auth_address, get_script_auth_program,
};
use lending_contracts::sdk::parameters::{
    FirstNFTParameters, LendingParameters, SecondNFTParameters,
};

use lending_contracts::sdk::{decode_pre_lock_metadata, taproot_unspendable_internal_key};
use simplicity_contracts::sdk::validation::TxOutExt;
use simplicityhl::elements::bitcoin::secp256k1;
use simplicityhl::elements::hashes::Hash;
use simplicityhl::elements::hex::ToHex;
use simplicityhl::elements::pset::serialize::Serialize;
use simplicityhl::elements::schnorr::XOnlyPublicKey;
use simplicityhl::elements::{Address, AssetId, OutPoint, Txid};
use simplicityhl::simplicity::ToXOnlyPubkey;
use simplicityhl::simplicity::hex::DisplayHex;
use simplicityhl::tracker::TrackerLogLevel;

use simplicity_contracts::sdk::taproot_pubkey_gen::get_random_seed;
use simplicity_contracts_cli::explorer::{ExplorerError, broadcast_tx, fetch_utxo};
use simplicity_contracts_cli::modules::utils::derive_keypair;

use simplicityhl_core::{
    Encodable, create_p2pk_signature, finalize_p2pk_transaction, get_and_verify_env, hash_script,
};

use crate::commands::NETWORK;
use crate::modules::store::Store;

/// Pre lock contract utilities
#[derive(Subcommand, Debug)]
pub enum PreLock {
    /// Show information about loan offer from the pre lock covenant creation transaction
    ShowInfo {
        /// Transaction ID with the pre lock covenant creation
        #[arg(long = "pre-lock-tx-id")]
        pre_lock_tx_id: Txid,
    },
    /// Issue four UTXOs of 100 satoshi each to facilitate the issuance of Utility NFTs.
    PrepareUtilityNFTSIssuance {
        /// Fee UTXO used to pay transaction fees
        #[arg(long = "fee-utxo")]
        fee_utxo: OutPoint,
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
    /// Issue Utility NFTs required to create a pre lock covenant UTXO using tx id with the issuance utxos
    IssueUtilityNFTSFromTX {
        /// Transaction ID with the utility NFTs issuance preparation
        #[arg(long = "pre-issuance-tx-id")]
        prep_issuance_tx_id: Txid,
        /// Fee UTXO used to pay transaction fees
        #[arg(long = "fee-utxo")]
        fee_utxo: OutPoint,
        /// Recipient address (Liquid testnet bech32m)
        #[arg(long = "to-address")]
        to_address: Address,
        /// Index of the first issuance utxo
        #[arg(long = "first-issuance-utxo-index")]
        first_issuance_utxo_index: u32,
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
    /// Issue Utility NFTs required to create a pre lock covenant UTXO
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
    /// Create a pre lock covenant UTXO and lock the collateral asset
    Create {
        /// Collateral UTXO containing the collateral asset
        #[arg(long = "collateral-utxo")]
        collateral_utxo: OutPoint,
        /// First parameters NFT UTXO
        #[arg(long = "first-parameters-nft-utxo")]
        first_parameters_nft_utxo: OutPoint,
        /// Second parameters NFT UTXO
        #[arg(long = "second-parameters-nft-utxo")]
        second_parameters_nft_utxo: OutPoint,
        /// Borrower NFT UTXO
        #[arg(long = "borrower-nft-utxo")]
        borrower_nft_utxo: OutPoint,
        /// Lender NFT UTXO
        #[arg(long = "lender-nft-utxo")]
        lender_nft_utxo: OutPoint,
        /// Fee UTXO used to pay transaction fees
        #[arg(long = "fee-utxo")]
        fee_utxo: OutPoint,
        /// Principal asset ID in hexadecimal (big-endian)
        #[arg(long = "principal-asset-id-hex-be")]
        principal_asset_id_hex_be: String,
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
    /// Cancel a pre lock covenant using the borrower signature
    Cancel {
        /// UTXO with the pre lock covenant script
        #[arg(long = "pre-lock-utxo")]
        pre_lock_utxo: OutPoint,
        /// First parameters NFT UTXO
        #[arg(long = "first-parameters-nft-utxo")]
        first_parameters_nft_utxo: OutPoint,
        /// Second parameters NFT UTXO
        #[arg(long = "second-parameters-nft-utxo")]
        second_parameters_nft_utxo: OutPoint,
        /// Borrower NFT UTXO
        #[arg(long = "borrower-nft-utxo")]
        borrower_nft_utxo: OutPoint,
        /// Lender NFT UTXO
        #[arg(long = "lender-nft-utxo")]
        lender_nft_utxo: OutPoint,
        /// Fee UTXO used to pay transaction fees
        #[arg(long = "fee-utxo")]
        fee_utxo: OutPoint,
        /// Pre lock covenant hash that in this CLI works as unique contract identifier
        #[arg(long = "pre-lock-cov-hash")]
        pre_lock_cov_hash: String,
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
    /// Create a lending covenant UTXO from the pre lock covenant
    CreateLending {
        /// UTXO with the pre lock covenant script
        #[arg(long = "pre-lock-utxo")]
        pre_lock_utxo: OutPoint,
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
        /// Lender NFT UTXO
        #[arg(long = "lender-nft-utxo")]
        lender_nft_utxo: OutPoint,
        /// Fee UTXO used to pay transaction fees
        #[arg(long = "fee-utxo")]
        fee_utxo: OutPoint,
        /// Pre lock covenant hash that in this CLI works as unique contract identifier
        #[arg(long = "pre-lock-cov-hash")]
        pre_lock_cov_hash: String,
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

impl PreLock {
    /// Handle pre lock CLI subcommand execution.
    ///
    /// # Errors
    /// Returns an error if the subcommand operation fails.
    ///
    /// # Panics
    /// - if `OP_RETURN` data fetching fails
    #[expect(clippy::too_many_lines)]
    pub async fn handle(&self) -> Result<()> {
        match self {
            Self::ShowInfo { pre_lock_tx_id } => {
                let pre_lock_utxo = OutPoint::new(*pre_lock_tx_id, 0);
                let first_parameters_nft_utxo = OutPoint::new(*pre_lock_tx_id, 1);
                let second_parameters_nft_utxo = OutPoint::new(*pre_lock_tx_id, 2);
                let borrower_nft_utxo = OutPoint::new(*pre_lock_tx_id, 3);
                let lender_nft_utxo = OutPoint::new(*pre_lock_tx_id, 4);
                let op_return_utxo = OutPoint::new(*pre_lock_tx_id, 5);
                let borrower_output_script_hash_utxo = OutPoint::new(*pre_lock_tx_id, 6);

                let pre_lock_tx_out = fetch_utxo(pre_lock_utxo).await?;
                let first_parameters_nft_tx_out = fetch_utxo(first_parameters_nft_utxo).await?;
                let second_parameters_nft_tx_out = fetch_utxo(second_parameters_nft_utxo).await?;
                let borrower_nft_tx_out = fetch_utxo(borrower_nft_utxo).await?;
                let lender_nft_tx_out = fetch_utxo(lender_nft_utxo).await?;
                let op_return_tx_out = fetch_utxo(op_return_utxo).await?;
                let borrower_output_script_hash_tx_out =
                    match fetch_utxo(borrower_output_script_hash_utxo).await {
                        Ok(tx_out) => Some(tx_out),
                        Err(ExplorerError::OutputIndexOutOfBounds { .. }) => None,
                        Err(err) => return Err(err.into()),
                    };

                let (pre_lock_asset_id, _) = pre_lock_tx_out.explicit()?;
                let (first_parameters_nft_asset_id, first_parameters_nft_value) =
                    first_parameters_nft_tx_out.explicit()?;
                let (second_parameters_nft_asset_id, second_parameters_nft_value) =
                    second_parameters_nft_tx_out.explicit()?;
                let (borrower_nft_asset_id, _) = borrower_nft_tx_out.explicit()?;
                let (lender_nft_asset_id, _) = lender_nft_tx_out.explicit()?;

                let first_parameters = FirstNFTParameters::decode(first_parameters_nft_value);
                let second_parameters = SecondNFTParameters::decode(second_parameters_nft_value);

                let lending_params = LendingParameters::build_from_parameters_nfts(
                    &first_parameters,
                    &second_parameters,
                );

                let mut op_return_instr_iter =
                    op_return_tx_out.script_pubkey.instructions_minimal();

                op_return_instr_iter.next();

                let op_return_bytes = op_return_instr_iter
                    .next()
                    .unwrap()
                    .unwrap()
                    .push_bytes()
                    .unwrap();

                let borrower_output_script_hash_bytes = borrower_output_script_hash_tx_out
                    .as_ref()
                    .filter(|tx_out| tx_out.is_null_data())
                    .and_then(|tx_out| {
                        let mut op_return_instr_iter = tx_out.script_pubkey.instructions_minimal();
                        let _ = op_return_instr_iter.next()?;
                        op_return_instr_iter
                            .next()
                            .and_then(Result::ok)
                            .and_then(|instruction| instruction.push_bytes())
                    });

                let metadata =
                    decode_pre_lock_metadata(op_return_bytes, borrower_output_script_hash_bytes)?;
                let principal_asset_id = metadata.principal_asset_id();
                let borrower_public_key =
                    XOnlyPublicKey::from_slice(&metadata.borrower_pub_key()).unwrap();

                println!("Pre Lock covenant info:");
                println!("Assets Info:");
                println!("\tCollateral asset id: {}", pre_lock_asset_id.to_hex());
                println!(
                    "\tPrincipal asset id: {}",
                    AssetId::from_slice(&principal_asset_id)?.to_hex()
                );
                println!(
                    "\tFirst Parameters NFT asset id: {}",
                    first_parameters_nft_asset_id.to_hex()
                );
                println!(
                    "\tSecond Parameters NFT asset id: {}",
                    second_parameters_nft_asset_id.to_hex()
                );
                println!(
                    "\tBorrower NFT asset id: {}",
                    borrower_nft_asset_id.to_hex()
                );
                println!("\tLender NFT asset id: {}", lender_nft_asset_id.to_hex());
                println!("Lending Offer Info:");
                println!("\tBorrower public key: {borrower_public_key}");
                if let Some(borrower_output_script) = metadata.borrower_output_script() {
                    println!(
                        "\tBorrower output script: {}",
                        borrower_output_script.to_hex()
                    );
                }
                if let Some(borrower_output_script_hash) = metadata.borrower_output_script_hash() {
                    println!(
                        "\tBorrower output script hash: {}",
                        borrower_output_script_hash.to_hex()
                    );
                }
                println!("\tCollateral amount: {}", lending_params.collateral_amount);
                println!("\tPrincipal amount: {}", lending_params.principal_amount);
                println!(
                    "\tLoan expiration time (block height): {}",
                    lending_params.loan_expiration_time
                );
                println!(
                    "\tPrincipal interest rate (100% = 10_000): {}",
                    lending_params.principal_interest_rate
                );

                Ok(())
            }
            Self::PrepareUtilityNFTSIssuance {
                fee_utxo,
                to_address,
                account_index,
                fee_amount,
                broadcast,
            } => {
                let keypair = derive_keypair(*account_index);

                let fee_tx_out = fetch_utxo(*fee_utxo).await?;

                let pst = lending_contracts::sdk::build_utility_nfts_issuance_preparation(
                    (*fee_utxo, fee_tx_out.clone()),
                    &to_address.script_pubkey().clone(),
                    *fee_amount,
                )?;

                let tx = pst.extract_tx()?;
                let utxos = vec![fee_tx_out.clone()];
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

                if *broadcast {
                    println!("Broadcast txid: {}", broadcast_tx(&tx).await?);
                } else {
                    println!("{}", tx.serialize().to_lower_hex_string());
                }

                Ok(())
            }
            Self::IssueUtilityNFTSFromTX {
                prep_issuance_tx_id,
                fee_utxo,
                to_address,
                first_issuance_utxo_index,
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

                let first_issuance_utxo =
                    OutPoint::new(*prep_issuance_tx_id, *first_issuance_utxo_index);
                let second_issuance_utxo =
                    OutPoint::new(*prep_issuance_tx_id, *first_issuance_utxo_index + 1);
                let third_issuance_utxo =
                    OutPoint::new(*prep_issuance_tx_id, *first_issuance_utxo_index + 2);
                let fourth_issuance_utxo =
                    OutPoint::new(*prep_issuance_tx_id, *first_issuance_utxo_index + 3);

                let first_tx_out = fetch_utxo(first_issuance_utxo).await?;
                let second_tx_out = fetch_utxo(second_issuance_utxo).await?;
                let third_tx_out = fetch_utxo(third_issuance_utxo).await?;
                let fourth_tx_out = fetch_utxo(fourth_issuance_utxo).await?;
                let fee_tx_out = fetch_utxo(*fee_utxo).await?;

                let issuance_asset_entropy = get_random_seed();

                let lending_params = LendingParameters {
                    collateral_amount: *collateral_amount,
                    principal_amount: *principal_amount,
                    principal_interest_rate: *principal_interest_rate,
                    loan_expiration_time: *loan_expiration_time,
                };

                let pst = lending_contracts::sdk::build_utility_nfts_issuing(
                    (first_issuance_utxo, first_tx_out.clone()),
                    (second_issuance_utxo, second_tx_out.clone()),
                    (third_issuance_utxo, third_tx_out.clone()),
                    (fourth_issuance_utxo, fourth_tx_out.clone()),
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
                    println!("Broadcast txid: {}", broadcast_tx(&tx).await?);
                } else {
                    println!("{}", tx.serialize().to_lower_hex_string());
                }

                Ok(())
            }
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
                    println!("Broadcast txid: {}", broadcast_tx(&tx).await?);
                } else {
                    println!("{}", tx.serialize().to_lower_hex_string());
                }

                Ok(())
            }
            Self::Create {
                collateral_utxo,
                first_parameters_nft_utxo,
                second_parameters_nft_utxo,
                borrower_nft_utxo,
                lender_nft_utxo,
                fee_utxo,
                principal_asset_id_hex_be,
                to_address,
                account_index,
                fee_amount,
                broadcast,
            } => {
                let store = Store::load()?;
                let keypair = derive_keypair(*account_index);
                let x_only_public_key = keypair.x_only_public_key().0;

                let collateral_tx_out = fetch_utxo(*collateral_utxo).await?;
                let first_parameters_nft_tx_out = fetch_utxo(*first_parameters_nft_utxo).await?;
                let second_parameters_nft_tx_out = fetch_utxo(*second_parameters_nft_utxo).await?;
                let borrower_nft_tx_out = fetch_utxo(*borrower_nft_utxo).await?;
                let lender_nft_tx_out = fetch_utxo(*lender_nft_utxo).await?;
                let fee_tx_out = fetch_utxo(*fee_utxo).await?;

                let principal_asset_id = AssetId::from_str(principal_asset_id_hex_be)?;
                let (collateral_asset_id, _) = collateral_tx_out.explicit()?;
                let (first_parameters_nft_asset_id, first_parameters_nft_value) =
                    first_parameters_nft_tx_out.explicit()?;
                let (second_parameters_nft_asset_id, second_parameters_nft_value) =
                    second_parameters_nft_tx_out.explicit()?;
                let (borrower_nft_asset_id, _) = borrower_nft_tx_out.explicit()?;
                let (lender_nft_asset_id, _) = lender_nft_tx_out.explicit()?;

                let first_nft_parameters = FirstNFTParameters::decode(first_parameters_nft_value);
                let second_nft_parameters =
                    SecondNFTParameters::decode(second_parameters_nft_value);

                let lending_params = LendingParameters::build_from_parameters_nfts(
                    &first_nft_parameters,
                    &second_nft_parameters,
                );

                // Calculate script hash for the AssetAuth covenant with the Lender NFT auth
                let asset_auth_arguments = AssetAuthArguments {
                    asset_id: lender_nft_asset_id.into_inner().0,
                    asset_amount: 1,
                    with_asset_burn: true,
                };
                let lender_principal_script = get_asset_auth_address(
                    &taproot_unspendable_internal_key(),
                    &asset_auth_arguments,
                    NETWORK,
                )?
                .script_pubkey();
                let principal_auth_script_hash = hash_script(&lender_principal_script);

                // Calculate Lending covenant script hash
                let lending_arguments = LendingArguments::new(
                    collateral_asset_id.into_inner().0,
                    principal_asset_id.into_inner().0,
                    borrower_nft_asset_id.into_inner().0,
                    lender_nft_asset_id.into_inner().0,
                    first_parameters_nft_asset_id.into_inner().0,
                    second_parameters_nft_asset_id.into_inner().0,
                    principal_auth_script_hash,
                    &lending_params,
                );
                let lending_script = get_lending_address(
                    &taproot_unspendable_internal_key(),
                    &lending_arguments,
                    NETWORK,
                )?
                .script_pubkey();
                let lending_cov_hash = hash_script(&lending_script);

                println!("Lending covenant hash: {}", lending_cov_hash.to_hex());
                store.import_arguments_by_key(
                    &lending_cov_hash.to_hex(),
                    &lending_arguments.to_hex()?,
                )?;

                // Calculate ScriptAuth covenant script hash for the parameters nft
                let script_auth_arguments = ScriptAuthArguments::new(lending_cov_hash);
                let script_auth_script = get_script_auth_address(
                    &taproot_unspendable_internal_key(),
                    &script_auth_arguments,
                    NETWORK,
                )?
                .script_pubkey();
                let parameters_nft_output_script_hash = hash_script(&script_auth_script);

                let to_address_script_hash = hash_script(&to_address.script_pubkey());

                let pre_lock_arguments = PreLockArguments::new(
                    collateral_asset_id.into_inner().0,
                    principal_asset_id.into_inner().0,
                    borrower_nft_asset_id.into_inner().0,
                    lender_nft_asset_id.into_inner().0,
                    first_parameters_nft_asset_id.into_inner().0,
                    second_parameters_nft_asset_id.into_inner().0,
                    lending_cov_hash,
                    parameters_nft_output_script_hash,
                    to_address_script_hash,
                    to_address_script_hash,
                    x_only_public_key.serialize(),
                    &lending_params,
                );

                let (pst, pre_lock_address) = lending_contracts::sdk::build_pre_lock_creation(
                    (*collateral_utxo, collateral_tx_out.clone()),
                    (
                        *first_parameters_nft_utxo,
                        first_parameters_nft_tx_out.clone(),
                    ),
                    (
                        *second_parameters_nft_utxo,
                        second_parameters_nft_tx_out.clone(),
                    ),
                    (*borrower_nft_utxo, borrower_nft_tx_out.clone()),
                    (*lender_nft_utxo, lender_nft_tx_out.clone()),
                    (*fee_utxo, fee_tx_out.clone()),
                    &pre_lock_arguments,
                    Some(&to_address.script_pubkey()),
                    *fee_amount,
                    NETWORK,
                )?;

                let tx = pst.extract_tx()?;
                let utxos = vec![
                    collateral_tx_out.clone(),
                    first_parameters_nft_tx_out.clone(),
                    second_parameters_nft_tx_out.clone(),
                    borrower_nft_tx_out.clone(),
                    lender_nft_tx_out.clone(),
                    fee_tx_out.clone(),
                ];

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

                let signature_5 = create_p2pk_signature(&tx, &utxos, &keypair, 5, NETWORK)?;
                let tx = finalize_p2pk_transaction(
                    tx,
                    &utxos,
                    &x_only_public_key,
                    &signature_5,
                    5,
                    NETWORK,
                    TrackerLogLevel::None,
                )?;

                let pre_lock_cov_hash = hash_script(&pre_lock_address.script_pubkey());

                println!("Pre lock covenant hash: {}", pre_lock_cov_hash.to_hex());
                store.import_arguments_by_key(
                    &pre_lock_cov_hash.to_hex(),
                    &pre_lock_arguments.to_hex()?,
                )?;

                if *broadcast {
                    println!("Broadcast txid: {}", broadcast_tx(&tx).await?);
                } else {
                    println!("{}", tx.serialize().to_lower_hex_string());
                }

                Ok(())
            }
            Self::Cancel {
                pre_lock_utxo,
                first_parameters_nft_utxo,
                second_parameters_nft_utxo,
                borrower_nft_utxo,
                lender_nft_utxo,
                fee_utxo,
                pre_lock_cov_hash,
                to_address,
                account_index,
                fee_amount,
                broadcast,
            } => {
                let store = Store::load()?;
                let keypair = derive_keypair(*account_index);
                let x_only_public_key = keypair.x_only_public_key().0;

                let pre_lock_arguments: PreLockArguments =
                    store.get_arguments(pre_lock_cov_hash)?;

                let pre_lock_tx_out = fetch_utxo(*pre_lock_utxo).await?;
                let first_parameters_nft_tx_out = fetch_utxo(*first_parameters_nft_utxo).await?;
                let second_parameters_nft_tx_out = fetch_utxo(*second_parameters_nft_utxo).await?;
                let borrower_nft_tx_out = fetch_utxo(*borrower_nft_utxo).await?;
                let lender_nft_tx_out = fetch_utxo(*lender_nft_utxo).await?;
                let fee_tx_out = fetch_utxo(*fee_utxo).await?;

                let pst = lending_contracts::sdk::build_pre_lock_cancellation(
                    (*pre_lock_utxo, pre_lock_tx_out.clone()),
                    (
                        *first_parameters_nft_utxo,
                        first_parameters_nft_tx_out.clone(),
                    ),
                    (
                        *second_parameters_nft_utxo,
                        second_parameters_nft_tx_out.clone(),
                    ),
                    (*borrower_nft_utxo, borrower_nft_tx_out.clone()),
                    (*lender_nft_utxo, lender_nft_tx_out.clone()),
                    (*fee_utxo, fee_tx_out.clone()),
                    &pre_lock_arguments,
                    &to_address.script_pubkey(),
                    *fee_amount,
                )?;

                let tx = pst.extract_tx()?;
                let utxos = vec![
                    pre_lock_tx_out.clone(),
                    first_parameters_nft_tx_out.clone(),
                    second_parameters_nft_tx_out.clone(),
                    borrower_nft_tx_out.clone(),
                    lender_nft_tx_out.clone(),
                    fee_tx_out.clone(),
                ];

                let unspendable_x_only_public_key =
                    taproot_unspendable_internal_key().to_x_only_pubkey();
                let pre_lock_program = get_pre_lock_program(&pre_lock_arguments)?;

                let env = get_and_verify_env(
                    &tx,
                    &pre_lock_program,
                    &unspendable_x_only_public_key,
                    &utxos,
                    NETWORK,
                    0,
                )?;

                let sighash_all = env.c_tx_env().sighash_all();
                let cancellation_signature = keypair
                    .sign_schnorr(secp256k1::Message::from_digest(sighash_all.to_byte_array()));

                let tx = finalize_pre_lock_transaction(
                    tx,
                    &unspendable_x_only_public_key,
                    &pre_lock_program,
                    &utxos,
                    0,
                    PreLockBranch::PreLockCancellation {
                        cancellation_signature: &cancellation_signature,
                    },
                    NETWORK,
                    TrackerLogLevel::None,
                )?;

                let pre_lock_script = get_pre_lock_address(
                    &unspendable_x_only_public_key,
                    &pre_lock_arguments,
                    NETWORK,
                )?
                .script_pubkey();

                let script_auth_arguments = ScriptAuthArguments::new(hash_script(&pre_lock_script));
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

                let tx = finalize_script_auth_transaction(
                    tx,
                    &unspendable_x_only_public_key,
                    &script_auth_program,
                    &utxos,
                    3,
                    &script_auth_witness_params,
                    NETWORK,
                    TrackerLogLevel::None,
                )?;

                let tx = finalize_script_auth_transaction(
                    tx,
                    &unspendable_x_only_public_key,
                    &script_auth_program,
                    &utxos,
                    4,
                    &script_auth_witness_params,
                    NETWORK,
                    TrackerLogLevel::None,
                )?;

                let signature_0 = create_p2pk_signature(&tx, &utxos, &keypair, 5, NETWORK)?;
                let tx = finalize_p2pk_transaction(
                    tx,
                    &utxos,
                    &x_only_public_key,
                    &signature_0,
                    5,
                    NETWORK,
                    TrackerLogLevel::None,
                )?;

                if *broadcast {
                    println!("Broadcast txid: {}", broadcast_tx(&tx).await?);
                } else {
                    println!("{}", tx.serialize().to_lower_hex_string());
                }

                Ok(())
            }
            Self::CreateLending {
                pre_lock_utxo,
                principal_utxo,
                first_parameters_nft_utxo,
                second_parameters_nft_utxo,
                borrower_nft_utxo,
                lender_nft_utxo,
                fee_utxo,
                pre_lock_cov_hash,
                to_address,
                account_index,
                fee_amount,
                broadcast,
            } => {
                let store = Store::load()?;
                let keypair = derive_keypair(*account_index);
                let x_only_public_key = keypair.x_only_public_key().0;

                let pre_lock_arguments: PreLockArguments =
                    store.get_arguments(pre_lock_cov_hash)?;

                let pre_lock_tx_out = fetch_utxo(*pre_lock_utxo).await?;
                let principal_tx_out = fetch_utxo(*principal_utxo).await?;
                let first_parameters_nft_tx_out = fetch_utxo(*first_parameters_nft_utxo).await?;
                let second_parameters_nft_tx_out = fetch_utxo(*second_parameters_nft_utxo).await?;
                let borrower_nft_tx_out = fetch_utxo(*borrower_nft_utxo).await?;
                let lender_nft_tx_out = fetch_utxo(*lender_nft_utxo).await?;
                let fee_tx_out = fetch_utxo(*fee_utxo).await?;

                let pst = lending_contracts::sdk::build_pre_lock_lending_creation(
                    (*pre_lock_utxo, pre_lock_tx_out.clone()),
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
                    (*lender_nft_utxo, lender_nft_tx_out.clone()),
                    (*fee_utxo, fee_tx_out.clone()),
                    &pre_lock_arguments,
                    &to_address.script_pubkey(),
                    *fee_amount,
                    NETWORK,
                )?;

                let tx = pst.extract_tx()?;
                let utxos = vec![
                    pre_lock_tx_out.clone(),
                    first_parameters_nft_tx_out.clone(),
                    second_parameters_nft_tx_out.clone(),
                    borrower_nft_tx_out.clone(),
                    lender_nft_tx_out.clone(),
                    principal_tx_out.clone(),
                    fee_tx_out.clone(),
                ];

                let unspendable_x_only_public_key =
                    taproot_unspendable_internal_key().to_x_only_pubkey();

                let tx = finalize_pre_lock_transaction(
                    tx,
                    &unspendable_x_only_public_key,
                    &get_pre_lock_program(&pre_lock_arguments)?,
                    &utxos,
                    0,
                    PreLockBranch::LendingCreation,
                    NETWORK,
                    TrackerLogLevel::None,
                )?;

                let pre_lock_script = get_pre_lock_address(
                    &unspendable_x_only_public_key,
                    &pre_lock_arguments,
                    NETWORK,
                )?
                .script_pubkey();

                let script_auth_arguments = ScriptAuthArguments::new(hash_script(&pre_lock_script));
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

                let tx = finalize_script_auth_transaction(
                    tx,
                    &unspendable_x_only_public_key,
                    &script_auth_program,
                    &utxos,
                    3,
                    &script_auth_witness_params,
                    NETWORK,
                    TrackerLogLevel::None,
                )?;

                let tx = finalize_script_auth_transaction(
                    tx,
                    &unspendable_x_only_public_key,
                    &script_auth_program,
                    &utxos,
                    4,
                    &script_auth_witness_params,
                    NETWORK,
                    TrackerLogLevel::None,
                )?;

                let signature_0 = create_p2pk_signature(&tx, &utxos, &keypair, 5, NETWORK)?;
                let tx = finalize_p2pk_transaction(
                    tx,
                    &utxos,
                    &x_only_public_key,
                    &signature_0,
                    5,
                    NETWORK,
                    TrackerLogLevel::None,
                )?;

                let signature_1 = create_p2pk_signature(&tx, &utxos, &keypair, 6, NETWORK)?;
                let tx = finalize_p2pk_transaction(
                    tx,
                    &utxos,
                    &x_only_public_key,
                    &signature_1,
                    6,
                    NETWORK,
                    TrackerLogLevel::None,
                )?;

                if *broadcast {
                    println!("Broadcast txid: {}", broadcast_tx(&tx).await?);
                } else {
                    println!("{}", tx.serialize().to_lower_hex_string());
                }

                Ok(())
            }
        }
    }
}
