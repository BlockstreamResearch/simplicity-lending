#![allow(clippy::similar_names)]

use std::str::FromStr;

use anyhow::Result;

use clap::Subcommand;

use lending_contracts::asset_auth::build_arguments::AssetAuthArguments;
use lending_contracts::asset_auth::get_asset_auth_address;
use lending_contracts::lending::build_arguments::LendingArguments;
use lending_contracts::lending::get_lending_address;
use lending_contracts::pre_lock::build_arguments::PreLockArguments;
use lending_contracts::script_auth::build_arguments::ScriptAuthArguments;
use lending_contracts::script_auth::get_script_auth_address;
use lending_contracts::sdk::parameters::{
    FirstNFTParameters, LendingParameters, SecondNFTParameters,
};

use lending_contracts::sdk::taproot_unspendable_internal_key;
use simplicity_contracts::sdk::validation::TxOutExt;
use simplicityhl::elements::pset::serialize::Serialize;
use simplicityhl::elements::{Address, AssetId, OutPoint};
use simplicityhl::simplicity::hex::DisplayHex;
use simplicityhl::tracker::TrackerLogLevel;

use simplicity_contracts::sdk::taproot_pubkey_gen::get_random_seed;
use simplicity_contracts_cli::explorer::{broadcast_tx, fetch_utxo};
use simplicity_contracts_cli::modules::store::Store;
use simplicity_contracts_cli::modules::utils::derive_keypair;

use simplicityhl_core::{Encodable, create_p2pk_signature, finalize_p2pk_transaction, hash_script};

use crate::commands::NETWORK;

/// Pre lock contract utilities
#[derive(Subcommand, Debug)]
pub enum PreLock {
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

                let (pst, pre_lock_taproot_pubkey_gen) =
                    lending_contracts::sdk::build_pre_lock_creation(
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

                store.import_arguments(
                    &pre_lock_taproot_pubkey_gen.to_string(),
                    &pre_lock_arguments.to_hex()?,
                    NETWORK,
                    &lending_contracts::pre_lock::get_pre_lock_address,
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
