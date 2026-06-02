use clap::Subcommand;

use simplex::provider::ProviderTrait;
use simplex::simplicityhl::elements::hex::ToHex;
use simplex::transaction::partial_input::IssuanceInput;
use simplex::transaction::{FinalTransaction, PartialInput, PartialOutput, RequiredSignature};

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
}

pub struct Issuance {}

impl Issuance {
    pub fn run(context: CliContext, command: &IssuanceCommand) -> Result<(), IssuanceCommandError> {
        match command {
            IssuanceCommand::IssueAsset {
                asset_amount,
                inflation_amount,
            } => Issuance::issue_asset(context, *asset_amount, *inflation_amount),
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

        println!(
            "Issuing new asset with id - {} and amount - {}",
            issuance_details.asset_id.to_hex(),
            asset_amount,
        );

        let (tx, _) = context.signer.finalize(&ft)?;
        let txid = context.esplora_provider.broadcast_transaction(&tx)?;

        println!("New asset successfully issued!");
        println!("Broadcast txid: {txid}");

        Ok(())
    }
}
