use clap::Subcommand;

use simplex::provider::ProviderTrait;
use simplex::simplicityhl::elements::hex::ToHex;
use simplex::simplicityhl::elements::{AssetId, OutPoint};
use simplex::transaction::partial_input::IssuanceInput;
use simplex::transaction::{FinalTransaction, PartialInput, PartialOutput, RequiredSignature};
use simplex::utils;

use lending_contracts::utils::get_random_seed;

use crate::cli::CliContext;
use crate::commands::issuance::IssuanceCommandError;

#[derive(Debug, Subcommand)]
pub enum IssuanceCommand {
    /// Issue arbitrary amount of new asset
    IssueAsset {
        /// Asset amount to issue
        #[arg(long = "asset-amount")]
        asset_amount: u64,

        /// Inflation token amount (reissuance tokens)
        #[arg(long = "inflation-amount")]
        inflation_amount: Option<u64>,
    },
    /// Calculate deterministic asset id from issuance outpoint and entropy
    #[command(name = "calculate_asset_id", visible_alias = "calculate-asset-id")]
    CalculateAssetId {
        /// Issuance outpoint in txid:vout format
        #[arg(long = "issuance-outpoint")]
        issuance_outpoint: OutPoint,
        /// Issuance entropy as 32-byte hex (64 chars, optional 0x prefix)
        #[arg(long = "entropy")]
        entropy: String,
        /// Show reissuance token id in output
        #[arg(long = "show-reissuance-id")]
        show_reissuance_id: bool,
    },
}

pub struct Issuance {}

impl Issuance {
    pub fn run(context: CliContext, command: &IssuanceCommand) -> Result<(), IssuanceCommandError> {
        match command {
            IssuanceCommand::IssueAsset {
                asset_amount,
                inflation_amount,
            } => Issuance::issue_asset(context, *asset_amount, *inflation_amount),
            IssuanceCommand::CalculateAssetId {
                issuance_outpoint,
                entropy,
                show_reissuance_id,
            } => Issuance::calculate_asset_id(*issuance_outpoint, entropy, *show_reissuance_id),
        }
    }

    fn issue_asset(
        context: CliContext,
        asset_amount: u64,
        inflation_amount: Option<u64>,
    ) -> Result<(), IssuanceCommandError> {
        let policy_utxos = context
            .signer
            .get_utxos_asset(context.get_network().policy_asset())?;
        let first_utxo = policy_utxos.first().expect("No policy UTXOs found");

        let asset_entropy = get_random_seed();

        let mut ft = FinalTransaction::new();

        let issuance_details = ft.add_issuance_input(
            PartialInput::new(first_utxo.clone()),
            IssuanceInput::new_issuance(asset_amount, inflation_amount.unwrap_or(0), asset_entropy),
            RequiredSignature::NativeEcdsa,
        );

        let signer_script_pubkey = context.signer.get_address().script_pubkey();

        ft.add_output(PartialOutput::new(
            signer_script_pubkey.clone(),
            asset_amount,
            issuance_details.asset_id,
        ));

        if let Some(amount) = inflation_amount.filter(|&a| a > 0) {
            ft.add_output(
                PartialOutput::new(
                    signer_script_pubkey.clone(),
                    amount,
                    issuance_details.inflation_asset_id,
                )
                .with_blinding_key(context.signer.get_blinding_public_key()),
            );
        }

        println!(
            "Issuing new asset with id - {}, amount - {}, entropy - {}",
            issuance_details.asset_id.to_hex(),
            asset_amount,
            issuance_details.asset_entropy,
        );
        println!("Issuance outpoint: {}", first_utxo.outpoint);
        println!("Input entropy: {}", hex::encode(asset_entropy));

        let (tx, _) = context.signer.finalize(&ft)?;
        let txid = context.esplora_provider.broadcast_transaction(&tx)?;

        println!("New asset successfully issued!");
        println!("Broadcast txid: {txid}");

        Ok(())
    }

    fn calculate_asset_id(
        outpoint: OutPoint,
        entropy: &str,
        show_reissuance_id: bool,
    ) -> Result<(), IssuanceCommandError> {
        let entropy_bytes = Issuance::parse_entropy(entropy)?;
        let asset_entropy = utils::asset_entropy(&outpoint, entropy_bytes);
        let asset_id = AssetId::from_entropy(asset_entropy);

        println!("Calculated issuance asset ID:");
        println!("Issuance outpoint: {outpoint}");
        println!("Input entropy: {}", hex::encode(entropy_bytes));
        println!("Asset ID: {}", asset_id.to_hex());
        if show_reissuance_id {
            let reissuance_token_id = AssetId::reissuance_token_from_entropy(asset_entropy, false);
            println!("Reissuance token ID: {}", reissuance_token_id.to_hex());
        }

        Ok(())
    }

    fn parse_entropy(entropy: &str) -> Result<[u8; 32], IssuanceCommandError> {
        let normalized_entropy = entropy.trim().trim_start_matches("0x");
        let decoded_entropy = hex::decode(normalized_entropy).map_err(|source| {
            IssuanceCommandError::InvalidEntropyHex {
                entropy: entropy.to_string(),
                source,
            }
        })?;
        let decoded_entropy_len = decoded_entropy.len();

        decoded_entropy
            .try_into()
            .map_err(|_| IssuanceCommandError::InvalidEntropyLength {
                actual_bytes: decoded_entropy_len,
            })
    }
}
