use clap::Subcommand;
use simplex::{
    provider::ProviderTrait,
    simplicityhl::elements::{Address, OutPoint, hex::ToHex},
    transaction::{FinalTransaction, PartialInput, PartialOutput, RequiredSignature},
};

use crate::{cli::CliContext, commands::account::AccountCommandError};

#[derive(Debug, Subcommand)]
pub enum AccountCommand {
    SendPolicyAsset {
        /// Recipient address (Liquid testnet bech32m)
        #[arg(long = "to-address")]
        to_address: Address,
        /// Policy amount to send
        #[arg(long = "amount")]
        amount: u64,
    },
    SplitUTXO {
        /// UTXO to split
        #[arg(long = "outpoint")]
        outpoint: OutPoint,
        /// Amounts to split the UTXO into
        #[arg(long = "amounts", value_delimiter = ',', num_args = 1..)]
        amounts: Vec<u64>,
    },
    ShowAccountInfo,
    ShowAccountUTXOS,
}

pub struct Account {}

impl Account {
    pub fn run(context: CliContext, command: &AccountCommand) -> Result<(), AccountCommandError> {
        match command {
            AccountCommand::SendPolicyAsset { to_address, amount } => {
                Account::send_policy_asset(context, to_address, *amount)
            }
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

        let (tx, _) = context.signer.send(to_address.script_pubkey(), amount)?;

        let txid = context.esplora_provider.broadcast_transaction(&tx)?;

        println!(
            "Successfully sent {amount} policy asset to the {}",
            to_address
        );
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
            .get_wpkh_utxos_filter(|utxo| utxo.0 == outpoint)?;

        if found_utxos.len() == 0 {
            return Err(AccountCommandError::NotASignerUTXO(outpoint));
        }

        let utxo_to_split = found_utxos.first().unwrap();

        let utxo_asset_id = utxo_to_split.1.asset.explicit().unwrap();
        let utxo_amount = utxo_to_split.1.value.explicit().unwrap();

        let mut ft = FinalTransaction::new(context.get_network());

        ft.add_input(
            PartialInput::new(utxo_to_split.0, utxo_to_split.1.clone()),
            RequiredSignature::NativeEcdsa,
        )?;

        let signer_script_pubkey = context.signer.get_wpkh_address()?.script_pubkey();
        let mut total_amount = 0;

        for amount in amounts {
            ft.add_output(PartialOutput::new(
                signer_script_pubkey.clone(),
                *amount,
                utxo_asset_id,
            ));
            total_amount += amount;
        }

        if total_amount <= utxo_amount {
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
        let signer_wpkh_address = context.signer.get_wpkh_address()?;
        let signer_schnorr_pubkey = context.signer.get_schnorr_public_key()?;

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
        let account_utxos = context.signer.get_wpkh_utxos()?;

        println!("Account has {} WPKH UTXOs:", account_utxos.len());

        for (index, utxo) in account_utxos.into_iter().enumerate() {
            let asset_id_str = match utxo.1.asset.explicit() {
                Some(asset_id) => asset_id.to_hex(),
                None => "Confidential asset".into(),
            };
            let asset_amount_str = match utxo.1.value.explicit() {
                Some(asset_amount) => asset_amount.to_string(),
                None => "Confidential amount".into(),
            };

            println!(
                "{}. Outpoint - {}, asset_id - {}, amount - {},",
                index + 1,
                utxo.0,
                asset_id_str,
                asset_amount_str,
            );
        }

        Ok(())
    }
}
