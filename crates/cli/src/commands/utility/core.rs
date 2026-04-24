use std::str::FromStr;

use clap::Subcommand;

use lending_contracts::programs::pre_lock::UTILITY_NFTS_COUNT;
use lending_contracts::utils::{LendingOfferParameters, get_random_seed};
use simplex::provider::ProviderTrait;
use simplex::simplicityhl::elements::AssetId;
use simplex::simplicityhl::elements::hex::ToHex;
use simplex::transaction::partial_input::IssuanceInput;
use simplex::transaction::{FinalTransaction, PartialInput, PartialOutput, RequiredSignature};

use crate::cli::CliContext;
use crate::commands::utility::UtilityCommandError;

#[derive(Debug, Subcommand)]
pub enum UtilityCommand {
    /// Issue arbitrary amount of new asset
    IssueAsset {
        /// Asset amount to issue
        #[arg(long = "asset-amount")]
        asset_amount: u64,
    },
    /// Issue preparation UTXOs for the Utility NFTs issuance process
    IssuePreparationUTXOS,
    /// Issue Utility NFTs for the loan offer
    IssueUtilityNfts {
        /// Preparation UTXOs asset ID in hexadecimal (big-endian)
        #[arg(long = "preparation-utxos-asset-id-hex-be")]
        preparation_utxos_asset_id_hex_be: String,
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
    },
}

const PREPARATION_UTXO_ASSET_AMOUNT: u64 = 10;

pub struct Utility {}

impl Utility {
    pub fn run(context: CliContext, command: &UtilityCommand) -> Result<(), UtilityCommandError> {
        match command {
            UtilityCommand::IssueAsset { asset_amount } => {
                Utility::issue_asset(context, *asset_amount)
            }
            UtilityCommand::IssuePreparationUTXOS => Utility::issue_preparation_utxos_tx(context),
            UtilityCommand::IssueUtilityNfts {
                preparation_utxos_asset_id_hex_be,
                collateral_amount,
                principal_amount,
                loan_expiration_time,
                principal_interest_rate,
            } => {
                let offer_parameters = LendingOfferParameters {
                    collateral_amount: *collateral_amount,
                    principal_amount: *principal_amount,
                    loan_expiration_time: *loan_expiration_time,
                    principal_interest_rate: *principal_interest_rate,
                };
                let preparation_utxos_asset_id =
                    AssetId::from_str(preparation_utxos_asset_id_hex_be)?;

                Utility::issue_utility_nfts_tx(
                    context,
                    preparation_utxos_asset_id,
                    offer_parameters,
                )
            }
        }
    }

    fn issue_asset(context: CliContext, asset_amount: u64) -> Result<(), UtilityCommandError> {
        let policy_utxos = context
            .signer
            .get_utxos_asset(context.get_network().policy_asset())?;
        let first_utxo = policy_utxos.first().expect("No policy UTXOs found");

        let asset_entropy = get_random_seed();

        let mut ft = FinalTransaction::new();

        let (asset_id, _) = ft.add_issuance_input(
            PartialInput::new(first_utxo.clone()),
            IssuanceInput::new(asset_amount, asset_entropy),
            RequiredSignature::NativeEcdsa,
        );

        let signer_script_pubkey = context.signer.get_address().script_pubkey();

        ft.add_output(PartialOutput::new(
            signer_script_pubkey.clone(),
            asset_amount,
            asset_id,
        ));

        println!(
            "Issuing new asset with id - {} and amount - {}",
            asset_id.to_hex(),
            asset_amount,
        );

        let (tx, _) = context.signer.finalize(&ft)?;
        let txid = context.esplora_provider.broadcast_transaction(&tx)?;

        println!("New asset successfully issued!");
        println!("Broadcast txid: {txid}");

        Ok(())
    }

    fn issue_preparation_utxos_tx(context: CliContext) -> Result<(), UtilityCommandError> {
        let signer_script_pubkey = context.signer.get_address().script_pubkey();

        let policy_utxos = context
            .signer
            .get_utxos_asset(context.get_network().policy_asset())?;
        let issuance_utxo = policy_utxos
            .first()
            .expect("Must be at least one policy asset UTXO to issue preparation utxos");

        let mut ft = FinalTransaction::new();

        let total_asset_amount = PREPARATION_UTXO_ASSET_AMOUNT * UTILITY_NFTS_COUNT as u64;
        let asset_entropy = get_random_seed();

        let (asset_id, _) = ft.add_issuance_input(
            PartialInput::new(issuance_utxo.clone()),
            IssuanceInput::new(total_asset_amount, asset_entropy),
            RequiredSignature::NativeEcdsa,
        );

        for _ in 0..UTILITY_NFTS_COUNT {
            ft.add_output(PartialOutput::new(
                signer_script_pubkey.clone(),
                PREPARATION_UTXO_ASSET_AMOUNT,
                asset_id,
            ));
        }

        println!(
            "Issuing preparation UTXOs with the {} asset id...",
            asset_id.to_hex()
        );

        let (tx, _) = context.signer.finalize(&ft)?;
        let txid = context.esplora_provider.broadcast_transaction(&tx)?;

        println!("Preparation UTXOs successfully issued!");
        println!("Broadcast txid: {txid}");

        Ok(())
    }

    fn issue_utility_nfts_tx(
        context: CliContext,
        preparation_utxos_asset_id: AssetId,
        offer_parameters: LendingOfferParameters,
    ) -> Result<(), UtilityCommandError> {
        let signer_script_pubkey = context.signer.get_address().script_pubkey();

        let issuance_utxos = context.signer.get_utxos_asset(preparation_utxos_asset_id)?;

        if issuance_utxos.len() != UTILITY_NFTS_COUNT {
            return Err(UtilityCommandError::InvalidPreparationUTXOsCount {
                expected: UTILITY_NFTS_COUNT,
                actual: issuance_utxos.len(),
            });
        }

        let mut ft = FinalTransaction::new();

        let (first_parameters_nft_amount, second_parameters_nft_amount) =
            offer_parameters.encode_parameters_nft_amounts(1)?;

        let utility_nfts_amounts = [
            first_parameters_nft_amount,
            second_parameters_nft_amount,
            1,
            1,
        ];
        let mut asset_ids: Vec<AssetId> = Vec::with_capacity(UTILITY_NFTS_COUNT);

        let issuance_asset_entropy = get_random_seed();

        for (index, utxo) in issuance_utxos.iter().enumerate() {
            let (asset_id, _) = ft.add_issuance_input(
                PartialInput::new(utxo.clone()),
                IssuanceInput::new(utility_nfts_amounts[index], issuance_asset_entropy),
                RequiredSignature::NativeEcdsa,
            );
            asset_ids.push(asset_id);
        }

        for (index, asset_id) in asset_ids.into_iter().enumerate() {
            ft.add_output(PartialOutput::new(
                signer_script_pubkey.clone(),
                utility_nfts_amounts[index],
                asset_id,
            ));
        }

        for utxo in issuance_utxos {
            ft.add_output(PartialOutput::new(
                signer_script_pubkey.clone(),
                utxo.explicit_amount(),
                utxo.explicit_asset(),
            ));
        }

        println!(
            "Issuing utility NFTs with the next offer parameters: {:?}",
            offer_parameters,
        );

        let (tx, _) = context.signer.finalize(&ft)?;
        let txid = context.esplora_provider.broadcast_transaction(&tx)?;

        println!("Utility NFTs successfully created!");
        println!("Broadcast txid: {txid}");

        Ok(())
    }
}
