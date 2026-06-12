use clap::Subcommand;

use simplex::provider::ProviderTrait;
use simplex::simplicityhl::elements::{Txid, hex::ToHex};
use simplex::transaction::partial_input::IssuanceInput;
use simplex::transaction::{FinalTransaction, PartialInput, PartialOutput, RequiredSignature};

use lending_contracts::programs::issuance_factory::{IssuanceFactory, IssuanceFactoryParameters};
use lending_contracts::programs::program::SimplexProgram;
use lending_contracts::utils::get_random_seed;

use crate::cli::CliContext;
use crate::commands::factory::FactoryCommandError;

const FACTORY_ASSET_TOTAL_AMOUNT: u64 = 2;

#[derive(Debug, Subcommand)]
pub enum FactoryCommand {
    /// Create a new issuance factory
    Create {
        /// Number of UTXOs the factory can use for issuance in a single transaction
        #[arg(long = "issuing-utxos-count")]
        issuing_utxos_count: u8,

        /// Reissuance flags bitmask: each bit enables reissuance for the corresponding UTXO slot
        #[arg(long = "reissuance-flags", default_value_t = 0)]
        reissuance_flags: u64,
    },

    /// Remove an existing issuance factory and burn its auth tokens
    #[command(name = "remove", visible_alias = "delete")]
    Remove {
        /// Txid of the factory creation transaction
        #[arg(long = "creation-txid")]
        creation_txid: Txid,
    },
}

pub struct Factory {}

impl Factory {
    pub fn run(context: CliContext, command: &FactoryCommand) -> Result<(), FactoryCommandError> {
        match command {
            FactoryCommand::Create {
                issuing_utxos_count,
                reissuance_flags,
            } => Factory::create(context, *issuing_utxos_count, *reissuance_flags),

            FactoryCommand::Remove { creation_txid } => Factory::remove(context, *creation_txid),
        }
    }

    fn create(
        context: CliContext,
        issuing_utxos_count: u8,
        reissuance_flags: u64,
    ) -> Result<(), FactoryCommandError> {
        let network = context.get_network();
        let signer = &context.signer;

        let policy_utxo = signer
            .get_utxos_asset(network.policy_asset())?
            .into_iter()
            .next()
            .expect("No policy UTXOs found");

        let parameters = IssuanceFactoryParameters {
            issuing_utxos_count,
            reissuance_flags,
            network,
        };
        let issuance_factory = IssuanceFactory::new(parameters);

        let factory_entropy = get_random_seed();

        let mut ft = FinalTransaction::new();

        let issuance_details = ft.add_issuance_input(
            PartialInput::new(policy_utxo),
            IssuanceInput::new_issuance(FACTORY_ASSET_TOTAL_AMOUNT, 0, factory_entropy),
            RequiredSignature::NativeEcdsa,
        );

        ft.add_output(PartialOutput::new(
            signer.get_address().script_pubkey(),
            1,
            issuance_details.asset_id,
        ));

        issuance_factory.attach_creation(&mut ft, issuance_details.asset_id, 1);

        let receipt = context.signer.broadcast(&ft)?;

        println!("Issuance factory created successfully!");
        println!(
            "Factory asset ID:      {}",
            issuance_details.asset_id.to_hex()
        );
        println!("Creation txid:         {receipt}");
        println!("issuing_utxos_count:   {issuing_utxos_count}");
        println!("reissuance_flags:      {reissuance_flags}");

        Ok(())
    }

    fn remove(context: CliContext, creation_txid: Txid) -> Result<(), FactoryCommandError> {
        let creation_tx = context.esplora_provider.fetch_transaction(&creation_txid)?;

        let (issuance_factory, factory_asset_id) =
            IssuanceFactory::try_from_tx(&creation_tx, context.get_network())?;

        let program_utxo = context
            .esplora_provider
            .fetch_scripthash_utxos(&issuance_factory.get_script_pubkey())?
            .into_iter()
            .next()
            .ok_or(FactoryCommandError::FactoryProgramUtxoNotFound)?;

        let auth_nft_utxo = context
            .signer
            .get_utxos_asset(factory_asset_id)?
            .into_iter()
            .next()
            .ok_or(FactoryCommandError::AuthNftUtxoNotFound)?;

        let mut ft = FinalTransaction::new();

        issuance_factory.attach_factory_removing(&mut ft, program_utxo);

        ft.add_input(
            PartialInput::new(auth_nft_utxo),
            RequiredSignature::NativeEcdsa,
        );

        let receipt = context.signer.broadcast(&ft)?;

        println!("Issuance factory removed successfully!");
        println!("Factory asset ID: {}", factory_asset_id.to_hex());
        println!("Broadcast txid:   {receipt}");

        Ok(())
    }
}
