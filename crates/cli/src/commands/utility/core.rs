use clap::Subcommand;
use simplex::simplicityhl::elements::hex::ToHex;
use simplex::simplicityhl::elements::{AssetId, OutPoint};
use simplex::utils;

use crate::commands::utility::UtilityCommandError;

#[derive(Debug, Subcommand)]
pub enum UtilityCommand {
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

pub struct Utility {}

impl Utility {
    pub fn run(command: &UtilityCommand) -> Result<(), UtilityCommandError> {
        match command {
            UtilityCommand::CalculateAssetId {
                issuance_outpoint,
                entropy,
                show_reissuance_id,
            } => Utility::calculate_asset_id(*issuance_outpoint, entropy, *show_reissuance_id),
        }
    }

    fn calculate_asset_id(
        outpoint: OutPoint,
        entropy: &str,
        show_reissuance_id: bool,
    ) -> Result<(), UtilityCommandError> {
        let entropy_bytes = Utility::parse_entropy(entropy)?;
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

    fn parse_entropy(entropy: &str) -> Result<[u8; 32], UtilityCommandError> {
        let normalized_entropy = entropy.trim().trim_start_matches("0x");
        let decoded_entropy = hex::decode(normalized_entropy).map_err(|source| {
            UtilityCommandError::InvalidEntropyHex {
                entropy: entropy.to_string(),
                source,
            }
        })?;
        let decoded_entropy_len = decoded_entropy.len();

        decoded_entropy
            .try_into()
            .map_err(|_| UtilityCommandError::InvalidEntropyLength {
                actual_bytes: decoded_entropy_len,
            })
    }
}
