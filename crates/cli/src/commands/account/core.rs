use std::{collections::HashSet, str::FromStr};

use clap::Subcommand;
use simplex::{
    simplicityhl::elements::{Address, AssetId, OutPoint, hex::ToHex},
    simplicityhl::simplicity::bitcoin::PublicKey,
    transaction::{FinalTransaction, PartialInput, PartialOutput, RequiredSignature},
};

use crate::{cli::CliContext, commands::account::AccountCommandError};

#[derive(Debug, Subcommand)]
pub enum AccountCommand {
    /// Send policy asset to another account
    SendPolicyAsset {
        /// Recipient address (Liquid testnet bech32m)
        #[arg(long = "to-address")]
        to_address: Address,
        /// Policy amount to send
        #[arg(long = "amount")]
        amount: u64,
    },
    /// Send policy asset to another account with confidential output
    SendConfidentialPolicyAsset {
        /// Recipient address (Liquid testnet bech32m)
        #[arg(long = "to-address")]
        to_address: Address,
        /// Recipient blinding public key in hexadecimal
        #[arg(long = "recipient-blinding-pubkey")]
        recipient_blinding_pubkey: String,
        /// Policy amount to send
        #[arg(long = "amount")]
        amount: u64,
    },
    /// Send arbitrary asset to another account
    SendAsset {
        /// Recipient address (Liquid testnet bech32m)
        #[arg(long = "to-address")]
        to_address: Address,
        /// Asset ID in hexadecimal (big-endian) to send
        #[arg(long = "asset-id-hex-be")]
        asset_id_hex_be: String,
        /// Policy amount to send
        #[arg(long = "amount")]
        amount: u64,
    },
    /// Send arbitrary asset to another account with confidential output
    SendConfidentialAsset {
        /// Recipient address (Liquid testnet bech32m)
        #[arg(long = "to-address")]
        to_address: Address,
        /// Recipient blinding public key in hexadecimal
        #[arg(long = "recipient-blinding-pubkey")]
        recipient_blinding_pubkey: String,
        /// Asset ID in hexadecimal (big-endian) to send
        #[arg(long = "asset-id-hex-be")]
        asset_id_hex_be: String,
        /// Policy amount to send
        #[arg(long = "amount")]
        amount: u64,
    },
    /// Split specific UTXO to different parts
    SplitUTXO {
        /// UTXO to split
        #[arg(long = "outpoint")]
        outpoint: OutPoint,
        /// Amounts to split the UTXO into
        #[arg(long = "amounts", value_delimiter = ',', num_args = 1..)]
        amounts: Vec<u64>,
    },
    /// Merge specific UTXOs into a single output
    MergeUTXO {
        /// UTXOs to merge (at least 2 required)
        #[arg(long = "outpoints", value_delimiter = ',', num_args = 2..)]
        outpoints: Vec<OutPoint>,
        /// Make the merged output confidential using the account blinding key
        #[arg(long = "confidential")]
        confidential: bool,
    },
    /// Show current account info
    ShowAccountInfo,
    /// Show account UTXOs
    ShowAccountUTXOS,
}

pub struct Account {}

impl Account {
    pub fn run(context: CliContext, command: &AccountCommand) -> Result<(), AccountCommandError> {
        match command {
            AccountCommand::SendPolicyAsset { to_address, amount } => {
                Account::send_policy_asset(context, to_address, *amount)
            }
            AccountCommand::SendConfidentialPolicyAsset {
                to_address,
                recipient_blinding_pubkey,
                amount,
            } => Account::send_confidential_policy_asset(
                context,
                to_address,
                recipient_blinding_pubkey,
                *amount,
            ),
            AccountCommand::SendAsset {
                to_address,
                asset_id_hex_be,
                amount,
            } => Account::send_asset(context, to_address, asset_id_hex_be, *amount),
            AccountCommand::SendConfidentialAsset {
                to_address,
                recipient_blinding_pubkey,
                asset_id_hex_be,
                amount,
            } => Account::send_confidential_asset(
                context,
                to_address,
                recipient_blinding_pubkey,
                asset_id_hex_be,
                *amount,
            ),
            AccountCommand::SplitUTXO { outpoint, amounts } => {
                Account::split_account_utxo(context, *outpoint, amounts)
            }
            AccountCommand::MergeUTXO {
                outpoints,
                confidential,
            } => Account::merge_account_utxos(context, outpoints, *confidential),
            AccountCommand::ShowAccountInfo => Account::show_account_info(context),
            AccountCommand::ShowAccountUTXOS => Account::show_account_utxos(context),
        }
    }

    fn send_policy_asset(
        context: CliContext,
        to_address: &Address,
        amount: u64,
    ) -> Result<(), AccountCommandError> {
        println!("Sending {amount} policy asset to the {}", to_address);

        let txid = context.signer.send(to_address.script_pubkey(), amount)?;

        println!(
            "Successfully sent {amount} policy asset to the {}",
            to_address
        );
        println!("Broadcast txid: {txid}");

        Ok(())
    }

    fn send_asset(
        context: CliContext,
        to_address: &Address,
        asset_id_hex_be: &str,
        amount: u64,
    ) -> Result<(), AccountCommandError> {
        let asset_id = AssetId::from_str(asset_id_hex_be)?;
        Account::send_asset_with_blinding(context, to_address, asset_id, None, amount)
    }

    fn send_confidential_policy_asset(
        context: CliContext,
        to_address: &Address,
        recipient_blinding_pubkey: &str,
        amount: u64,
    ) -> Result<(), AccountCommandError> {
        let policy_asset_id = context.get_network().policy_asset();
        Account::send_asset_with_blinding(
            context,
            to_address,
            policy_asset_id,
            Some(recipient_blinding_pubkey),
            amount,
        )
    }

    fn send_confidential_asset(
        context: CliContext,
        to_address: &Address,
        recipient_blinding_pubkey: &str,
        asset_id_hex_be: &str,
        amount: u64,
    ) -> Result<(), AccountCommandError> {
        let asset_id = AssetId::from_str(asset_id_hex_be)?;
        Account::send_asset_with_blinding(
            context,
            to_address,
            asset_id,
            Some(recipient_blinding_pubkey),
            amount,
        )
    }

    fn send_asset_with_blinding(
        context: CliContext,
        to_address: &Address,
        asset_id: AssetId,
        recipient_blinding_pubkey: Option<&str>,
        amount: u64,
    ) -> Result<(), AccountCommandError> {
        let recipient_blinding_pubkey = recipient_blinding_pubkey
            .map(|key| {
                PublicKey::from_str(key).map_err(|source| {
                    AccountCommandError::InvalidRecipientBlindingPublicKey {
                        key: key.to_owned(),
                        source,
                    }
                })
            })
            .transpose()?;
        let asset_utxos = context.signer.get_utxos_asset(asset_id)?;

        let mut inputs = Vec::new();
        let mut total_inputs_amount = 0;

        for utxo in asset_utxos {
            total_inputs_amount += utxo.amount();
            inputs.push((utxo, RequiredSignature::NativeEcdsa));

            if total_inputs_amount >= amount {
                break;
            }
        }

        if total_inputs_amount < amount {
            return Err(AccountCommandError::NotEnoughAsset {
                asset_id: asset_id.to_hex(),
                needed_amount: amount,
                actual_amount: total_inputs_amount,
            });
        }

        let mut ft = FinalTransaction::new();

        for input in inputs {
            ft.add_input(PartialInput::new(input.0), input.1);
        }

        let recipient_output = PartialOutput::new(to_address.script_pubkey(), amount, asset_id);
        ft.add_output(match recipient_blinding_pubkey {
            Some(blinding_pubkey) => recipient_output.with_blinding_key(blinding_pubkey),
            None => recipient_output,
        });

        if total_inputs_amount > amount {
            ft.add_output(PartialOutput::new(
                context.signer.get_address().script_pubkey(),
                total_inputs_amount - amount,
                asset_id,
            ));
        }

        println!(
            "Sending {amount} of the {} asset to the {to_address}",
            asset_id.to_hex()
        );

        let receipt = context.signer.broadcast(&ft)?;

        println!("Asset successfully sent");
        println!("Broadcast txid: {receipt}");

        Ok(())
    }

    fn split_account_utxo(
        context: CliContext,
        outpoint: OutPoint,
        amounts: &[u64],
    ) -> Result<(), AccountCommandError> {
        let found_utxos = context
            .signer
            .get_utxos_filter(&|utxo| utxo.outpoint == outpoint, &|utxo| {
                utxo.outpoint == outpoint
            })?;

        if found_utxos.is_empty() {
            return Err(AccountCommandError::NotASignerUTXO(outpoint));
        }

        let utxo_to_split = found_utxos.first().unwrap();

        let utxo_asset_id = utxo_to_split.asset();
        let utxo_amount = utxo_to_split.amount();

        let mut ft = FinalTransaction::new();

        ft.add_input(
            PartialInput::new(utxo_to_split.clone()),
            RequiredSignature::NativeEcdsa,
        );

        let signer_script_pubkey = context.signer.get_address().script_pubkey();
        let mut total_amount = 0;

        for amount in amounts {
            ft.add_output(PartialOutput::new(
                signer_script_pubkey.clone(),
                *amount,
                utxo_asset_id,
            ));
            total_amount += amount;
        }

        if total_amount > utxo_amount {
            return Err(AccountCommandError::AmountsToSplitTooLarge {
                utxo_amount,
                total_amount_to_split: total_amount,
            });
        }

        if utxo_asset_id != context.get_network().policy_asset() && total_amount < utxo_amount {
            ft.add_output(PartialOutput::new(
                signer_script_pubkey.clone(),
                utxo_amount - total_amount,
                utxo_asset_id,
            ));
        }

        println!("Splitting UTXO with {:?} outpoint", outpoint);

        let receipt = context.signer.broadcast(&ft)?;

        println!("UTXO successfully split!");
        println!("Broadcast txid: {receipt}");

        Ok(())
    }

    fn merge_account_utxos(
        context: CliContext,
        outpoints: &[OutPoint],
        confidential: bool,
    ) -> Result<(), AccountCommandError> {
        if outpoints.len() < 2 {
            return Err(AccountCommandError::MissingOutpointsToMerge);
        }

        let mut selected_outpoints = HashSet::with_capacity(outpoints.len());
        for outpoint in outpoints {
            if !selected_outpoints.insert(*outpoint) {
                return Err(AccountCommandError::DuplicateOutpoint(*outpoint));
            }
        }

        let found_utxos = context.signer.get_utxos_filter(
            &|utxo| selected_outpoints.contains(&utxo.outpoint),
            &|utxo| selected_outpoints.contains(&utxo.outpoint),
        )?;

        let found_outpoints: HashSet<OutPoint> =
            found_utxos.iter().map(|utxo| utxo.outpoint).collect();
        let missing: Vec<OutPoint> = selected_outpoints
            .iter()
            .filter(|op| !found_outpoints.contains(*op))
            .copied()
            .collect();
        if !missing.is_empty() {
            return Err(AccountCommandError::NotSignerUTXOs(missing));
        }

        let first_utxo = &found_utxos[0];
        let merged_asset_id = first_utxo.asset();
        let mut total_amount = 0;
        let mut ft = FinalTransaction::new();

        for utxo in found_utxos {
            let utxo_asset_id = utxo.asset();
            if utxo_asset_id != merged_asset_id {
                return Err(AccountCommandError::UTXOsAssetMismatch {
                    expected_asset_id: merged_asset_id.to_hex(),
                    actual_asset_id: utxo_asset_id.to_hex(),
                    outpoint: utxo.outpoint,
                });
            }

            total_amount += utxo.amount();
            ft.add_input(PartialInput::new(utxo), RequiredSignature::NativeEcdsa);
        }

        let merged_output = PartialOutput::new(
            context.signer.get_address().script_pubkey(),
            total_amount,
            merged_asset_id,
        );
        ft.add_output(if confidential {
            merged_output.with_blinding_key(context.signer.get_blinding_public_key())
        } else {
            merged_output
        });

        println!(
            "Merging {} UTXOs into a single {} output (asset: {}, amount: {})",
            selected_outpoints.len(),
            if confidential {
                "confidential"
            } else {
                "explicit"
            },
            merged_asset_id.to_hex(),
            total_amount,
        );

        let receipt = context.signer.broadcast(&ft)?;

        println!("UTXOs successfully merged!");
        println!("Broadcast txid: {receipt}");

        Ok(())
    }

    fn show_account_info(context: CliContext) -> Result<(), AccountCommandError> {
        let signer_wpkh_address = context.signer.get_address();
        let signer_confidential_address = context.signer.get_confidential_address();
        let signer_schnorr_pubkey = context.signer.get_schnorr_public_key();
        let signer_blinding_pubkey = context.signer.get_blinding_public_key();

        println!("User WPKH address: {:?}", signer_wpkh_address);
        println!(
            "User confidential address: {:?}",
            signer_confidential_address
        );
        println!(
            "User WPKH script pubkey: {:?}",
            signer_wpkh_address.script_pubkey().to_hex()
        );
        println!(
            "User Schnorr public key: {:?}",
            signer_schnorr_pubkey.to_hex()
        );
        println!("User blinding public key: {signer_blinding_pubkey}");

        Ok(())
    }

    fn show_account_utxos(context: CliContext) -> Result<(), AccountCommandError> {
        let account_utxos = context.signer.get_utxos()?;

        println!("Account has {} WPKH UTXOs:", account_utxos.len());

        for (index, utxo) in account_utxos.into_iter().enumerate() {
            let asset_id_str = match utxo.txout.asset.explicit() {
                Some(asset_id) => asset_id.to_hex(),
                None => "Confidential asset".into(),
            };
            let asset_amount_str = match utxo.txout.value.explicit() {
                Some(asset_amount) => asset_amount.to_string(),
                None => "Confidential amount".into(),
            };

            println!(
                "{}. Outpoint - {}, asset_id - {}, amount - {},",
                index + 1,
                utxo.outpoint,
                asset_id_str,
                asset_amount_str,
            );
        }

        Ok(())
    }
}
