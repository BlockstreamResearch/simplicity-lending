#![allow(clippy::similar_names)]

use std::str::FromStr;

use anyhow::Result;

use clap::Subcommand;

use lending_contracts::script_auth::build_arguments::ScriptAuthArguments;
use lending_contracts::script_auth::{finalize_script_auth_transaction, get_script_auth_program};
use simplicity_contracts::sdk::taproot_pubkey_gen::TaprootPubkeyGen;
use simplicityhl::elements::OutPoint;
use simplicityhl::elements::hashes::sha256;
use simplicityhl::elements::pset::serialize::Serialize;
use simplicityhl::simplicity::hex::DisplayHex;
use simplicityhl::tracker::TrackerLogLevel;

use simplicity_contracts_cli::explorer::{broadcast_tx, fetch_utxo};
use simplicity_contracts_cli::modules::store::Store;
use simplicity_contracts_cli::modules::utils::derive_keypair;

use simplicityhl_core::{Encodable, create_p2pk_signature, finalize_p2pk_transaction};

use crate::commands::NETWORK;

#[derive(Subcommand, Debug)]
pub enum ScriptAuth {
    /// Create a script auth covenant UTXO and lock the asset
    Create {
        /// UTXO containing the asset to lock
        #[arg(long = "utxo-to-lock")]
        utxo_to_lock: OutPoint,
        /// Fee UTXO used to pay transaction fees
        #[arg(long = "fee-utxo")]
        fee_utxo: OutPoint,
        /// Script hash to use for authorization in hexadecimal
        #[arg(long = "auth-script-hash-hex")]
        auth_script_hash_hex: String,
        /// Account index that will pay for transaction fees
        #[arg(long = "account-index")]
        account_index: u32,
        /// Fee amount in satoshis (LBTC)
        #[arg(long = "fee-amount")]
        fee_amount: u64,
        /// When set, broadcast the built transaction via Esplora and print the transaction ID
        #[arg(long = "broadcast")]
        broadcast: bool,
    },
    /// Unlock an script auth covenant UTXO by providing the authorization utxo with the required script
    Unlock {
        /// UTXO locked by the script auth covenant
        #[arg(long = "locked-utxo")]
        locked_utxo: OutPoint,
        /// Authorization asset UTXO containing the authorization script
        #[arg(long = "auth-utxo")]
        auth_utxo: OutPoint,
        /// Fee UTXO used to pay transaction fees
        #[arg(long = "fee-utxo")]
        fee_utxo: OutPoint,
        /// Script auth taproot pubkey generator string
        #[arg(long = "script-auth-taproot-pubkey-gen")]
        script_auth_taproot_pubkey_gen: String,
        /// Account index that will pay for transaction fees
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

impl ScriptAuth {
    /// Handle script auth CLI subcommand execution.
    ///
    /// # Errors
    /// Returns an error if the subcommand operation fails.
    #[expect(clippy::too_many_lines)]
    pub async fn handle(&self) -> Result<()> {
        match self {
            Self::Create {
                utxo_to_lock,
                fee_utxo,
                auth_script_hash_hex,
                account_index,
                fee_amount,
                broadcast,
            } => {
                let store = Store::load()?;
                let keypair = derive_keypair(*account_index);
                let x_only_public_key = keypair.x_only_public_key().0;

                let utxo_to_lock_tx_out = fetch_utxo(*utxo_to_lock).await?;
                let fee_tx_out = fetch_utxo(*fee_utxo).await?;

                let script_hash = sha256::Midstate::from_str(auth_script_hash_hex)?.0;

                let script_auth_arguments = ScriptAuthArguments::new(script_hash);

                let (pst, script_auth_pubkey_gen) =
                    lending_contracts::sdk::build_script_auth_creation(
                        (*utxo_to_lock, utxo_to_lock_tx_out.clone()),
                        (*fee_utxo, fee_tx_out.clone()),
                        &script_auth_arguments,
                        *fee_amount,
                        NETWORK,
                    )?;

                let tx = pst.extract_tx()?;
                let utxos = vec![utxo_to_lock_tx_out.clone(), fee_tx_out.clone()];

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

                println!("script_auth_pubkey_gen: {script_auth_pubkey_gen}");

                store.import_arguments(
                    &script_auth_pubkey_gen.to_string(),
                    &script_auth_arguments.to_hex()?,
                    NETWORK,
                    &lending_contracts::script_auth::get_script_auth_address,
                )?;

                if *broadcast {
                    println!("Broadcast txid: {}", broadcast_tx(&tx).await?);
                } else {
                    println!("{}", tx.serialize().to_lower_hex_string());
                }

                Ok(())
            }
            Self::Unlock {
                locked_utxo,
                auth_utxo,
                fee_utxo,
                script_auth_taproot_pubkey_gen,
                account_index,
                fee_amount,
                broadcast,
            } => {
                let store = Store::load()?;
                let keypair = derive_keypair(*account_index);
                let x_only_public_key = keypair.x_only_public_key().0;

                let locked_tx_out = fetch_utxo(*locked_utxo).await?;
                let auth_tx_out = fetch_utxo(*auth_utxo).await?;
                let fee_tx_out = fetch_utxo(*fee_utxo).await?;

                let script_auth_arguments: ScriptAuthArguments =
                    store.get_arguments(script_auth_taproot_pubkey_gen)?;

                let taproot_pubkey_gen = TaprootPubkeyGen::build_from_str(
                    script_auth_taproot_pubkey_gen,
                    &script_auth_arguments,
                    NETWORK,
                    &lending_contracts::script_auth::get_script_auth_address,
                )?;

                let (pst, witness_params) = lending_contracts::sdk::build_script_auth_unlock(
                    (*locked_utxo, locked_tx_out.clone()),
                    (*auth_utxo, auth_tx_out.clone()),
                    (*fee_utxo, fee_tx_out.clone()),
                    &script_auth_arguments,
                    *fee_amount,
                )?;

                let tx = pst.extract_tx()?;
                let utxos = vec![
                    locked_tx_out.clone(),
                    auth_tx_out.clone(),
                    fee_tx_out.clone(),
                ];

                let tx = finalize_script_auth_transaction(
                    tx,
                    &taproot_pubkey_gen.get_x_only_pubkey(),
                    &get_script_auth_program(&script_auth_arguments)?,
                    &utxos,
                    0,
                    &witness_params,
                    NETWORK,
                    TrackerLogLevel::None,
                )?;

                let signature_0 = create_p2pk_signature(&tx, &utxos, &keypair, 1, NETWORK)?;
                let tx = finalize_p2pk_transaction(
                    tx,
                    &utxos,
                    &x_only_public_key,
                    &signature_0,
                    1,
                    NETWORK,
                    TrackerLogLevel::None,
                )?;

                let signature_1 = create_p2pk_signature(&tx, &utxos, &keypair, 2, NETWORK)?;
                let tx = finalize_p2pk_transaction(
                    tx,
                    &utxos,
                    &x_only_public_key,
                    &signature_1,
                    2,
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
