use clap::Subcommand;

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
    /// Reissue asset using owned reissuance token UTXO
    ReissueAsset {
        /// Reissuance token outpoint in txid:vout format
        #[arg(long = "reissuance-outpoint")]
        reissuance_outpoint: OutPoint,
        /// Asset entropy bytes as 32-byte hex (64 chars, optional 0x prefix).
        #[arg(long = "asset-entropy")]
        asset_entropy: String,
        /// Amount of asset to reissue
        #[arg(long = "asset-amount")]
        asset_amount: u64,
    },
    /// Calculate deterministic asset id from issuance outpoint and entropy
    #[command(name = "calculate_asset_id", visible_alias = "calculate-asset-id")]
    CalculateAssetId {
        /// Issuance outpoint in txid:vout format
        #[arg(long = "issuance-outpoint")]
        issuance_outpoint: OutPoint,
        /// Input entropy (issuance seed) as 32-byte hex (64 chars, optional 0x prefix)
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
            IssuanceCommand::ReissueAsset {
                reissuance_outpoint,
                asset_entropy,
                asset_amount,
            } => {
                Issuance::reissue_asset(context, *reissuance_outpoint, asset_entropy, *asset_amount)
            }
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
            "Issuing new asset with id - {}, amount - {}",
            issuance_details.asset_id.to_hex(),
            asset_amount,
        );
        println!("Issuance outpoint: {}", first_utxo.outpoint);
        println!(
            "Asset entropy bytes (hex, 32 bytes): {}",
            hex::encode(issuance_details.asset_entropy.to_byte_array())
        );
        println!("Input entropy: {}", hex::encode(asset_entropy));

        let receipt = context.signer.broadcast(&ft)?;

        println!("New asset successfully issued!");
        println!("Broadcast txid: {receipt}");

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

    fn reissue_asset(
        context: CliContext,
        reissuance_outpoint: OutPoint,
        asset_entropy: &str,
        asset_amount: u64,
    ) -> Result<(), IssuanceCommandError> {
        let asset_entropy_bytes = Issuance::parse_entropy(asset_entropy)?;
        let matching_utxos = context
            .signer
            .get_utxos_filter(&|utxo| utxo.outpoint == reissuance_outpoint, &|utxo| {
                utxo.outpoint == reissuance_outpoint
            })?;
        let reissuance_utxo = matching_utxos
            .first()
            .ok_or(IssuanceCommandError::NotASignerUTXO(reissuance_outpoint))?;

        if reissuance_utxo.secrets.is_none() {
            return Err(IssuanceCommandError::ReissuanceInputMustBeConfidential(
                reissuance_outpoint,
            ));
        }

        let reissuance_utxo_asset_id = reissuance_utxo.asset();

        let reissuance_token_amount = reissuance_utxo.amount();
        let mut ft = FinalTransaction::new();
        let issuance_details = ft.add_issuance_input(
            PartialInput::new(reissuance_utxo.clone()),
            IssuanceInput::new_reissuance(asset_amount, asset_entropy_bytes),
            RequiredSignature::NativeEcdsa,
        );
        let expected_reissuance_token_id = issuance_details.inflation_asset_id;

        if reissuance_utxo_asset_id != expected_reissuance_token_id {
            return Err(IssuanceCommandError::InvalidReissuanceTokenAsset {
                outpoint: reissuance_outpoint,
                expected_asset_id: expected_reissuance_token_id.to_hex(),
                actual_asset_id: reissuance_utxo_asset_id.to_hex(),
            });
        }

        let signer_script_pubkey = context.signer.get_address().script_pubkey();

        ft.add_output(PartialOutput::new(
            signer_script_pubkey.clone(),
            asset_amount,
            issuance_details.asset_id,
        ));
        ft.add_output(
            PartialOutput::new(
                signer_script_pubkey,
                reissuance_token_amount,
                expected_reissuance_token_id,
            )
            .with_blinding_key(context.signer.get_blinding_public_key()),
        );

        println!(
            "Reissuing asset with id - {}, amount - {}",
            issuance_details.asset_id.to_hex(),
            asset_amount,
        );
        println!("Reissuance outpoint: {reissuance_outpoint}");
        println!(
            "Reissuance token asset id: {}",
            expected_reissuance_token_id.to_hex()
        );
        println!(
            "Asset entropy bytes (hex, 32 bytes): {}",
            hex::encode(asset_entropy_bytes)
        );

        let receipt = context.signer.broadcast(&ft)?;

        println!("Asset successfully reissued!");
        println!("Broadcast txid: {receipt}");

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
