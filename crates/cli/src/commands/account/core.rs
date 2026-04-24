use std::str::FromStr;

use clap::Subcommand;
use simplex::{
    provider::ProviderTrait,
    simplicityhl::elements::{Address, AssetId, OutPoint, hex::ToHex},
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
    /// Split specific UTXO to different parts
    SplitUTXO {
        /// UTXO to split
        #[arg(long = "outpoint")]
        outpoint: OutPoint,
        /// Amounts to split the UTXO into
        #[arg(long = "amounts", value_delimiter = ',', num_args = 1..)]
        amounts: Vec<u64>,
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
            AccountCommand::SendAsset {
                to_address,
                asset_id_hex_be,
                amount,
            } => Account::send_asset(context, to_address, asset_id_hex_be, *amount),
            AccountCommand::SplitUTXO { outpoint, amounts } => {
                Account::split_account_utxo(context, *outpoint, amounts)
            }
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

        let asset_utxos = context.signer.get_utxos_asset(asset_id)?;

        let mut inputs = Vec::new();
        let mut total_inputs_amount = 0;

        for utxo in asset_utxos {
            total_inputs_amount += utxo.explicit_amount();
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

        ft.add_output(PartialOutput::new(
            to_address.script_pubkey(),
            amount,
            asset_id,
        ));

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

        let (tx, _) = context.signer.finalize(&ft)?;

        let txid = context.esplora_provider.broadcast_transaction(&tx)?;

        println!("Asset successfully sent");
        println!("Broadcast txid: {txid}");

        Ok(())
    }

    fn split_account_utxo(
        context: CliContext,
        outpoint: OutPoint,
        amounts: &Vec<u64>,
    ) -> Result<(), AccountCommandError> {
        let found_utxos = context
            .signer
            .get_utxos_filter(&|utxo| utxo.outpoint == outpoint, &|_| true)?;

        if found_utxos.is_empty() {
            return Err(AccountCommandError::NotASignerUTXO(outpoint));
        }

        let utxo_to_split = found_utxos.first().unwrap();

        let utxo_asset_id = utxo_to_split.explicit_asset();
        let utxo_amount = utxo_to_split.explicit_amount();

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

        let (tx, _) = context.signer.finalize(&ft)?;
        let txid = context.esplora_provider.broadcast_transaction(&tx)?;

        println!("UTXO successfully split!");
        println!("Broadcast txid: {txid}");

        Ok(())
    }

    fn show_account_info(context: CliContext) -> Result<(), AccountCommandError> {
        let signer_wpkh_address = context.signer.get_address();
        let signer_schnorr_pubkey = context.signer.get_schnorr_public_key();

        println!("User WPKH address: {:?}", signer_wpkh_address);
        println!(
            "User WPKH script pubkey: {:?}",
            signer_wpkh_address.script_pubkey().to_hex()
        );
        println!(
            "User Schnorr public key: {:?}",
            signer_schnorr_pubkey.to_hex()
        );

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
