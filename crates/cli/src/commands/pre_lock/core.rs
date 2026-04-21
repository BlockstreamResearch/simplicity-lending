use std::str::FromStr;

use clap::Subcommand;

use lending_contracts::programs::pre_lock::{PreLock, PreLockParameters};
use lending_contracts::utils::{FirstNFTParameters, LendingOfferParameters, SecondNFTParameters};
use simplex::provider::ProviderTrait;
use simplex::simplicityhl::elements::{AssetId, OutPoint, Txid};
use simplex::transaction::{
    FinalTransaction, PartialInput, PartialOutput, RequiredSignature, UTXO,
};
use simplex::utils::hash_script;

use crate::cli::CliContext;
use crate::commands::pre_lock::PreLockCommandError;

#[derive(Debug, Subcommand)]
pub enum PreLockCommand {
    /// Finish offer creation process
    Create {
        /// Utility NFTs issuance txid
        #[arg(long = "utility-nfts-issuance-txid")]
        utility_nfts_issuance_txid: Txid,
        /// Collateral asset ID in hexadecimal (big-endian)
        #[arg(long = "collateral-asset-id-hex-be")]
        collateral_asset_id_hex_be: String,
        /// Principal asset ID in hexadecimal (big-endian)
        #[arg(long = "principal-asset-id-hex-be")]
        principal_asset_id_hex_be: String,
    },
    /// Accept offer as a lender
    CreateLending {
        /// PreLock covenant creation txid
        #[arg(long = "pre-lock-creation-txid")]
        pre_lock_creation_txid: Txid,
    },
    /// Cancel offer as a borrower
    CancelOffer {
        /// PreLock covenant creation txid
        #[arg(long = "pre-lock-creation-txid")]
        pre_lock_creation_txid: Txid,
    },
}

pub struct CliPreLock {}

impl CliPreLock {
    pub fn run(context: CliContext, command: &PreLockCommand) -> Result<(), PreLockCommandError> {
        match command {
            PreLockCommand::Create {
                utility_nfts_issuance_txid,
                collateral_asset_id_hex_be,
                principal_asset_id_hex_be,
            } => CliPreLock::create_pre_lock(
                context,
                *utility_nfts_issuance_txid,
                collateral_asset_id_hex_be,
                principal_asset_id_hex_be,
            ),
            PreLockCommand::CreateLending {
                pre_lock_creation_txid,
            } => CliPreLock::create_lending_from_pre_lock(context, *pre_lock_creation_txid),
            PreLockCommand::CancelOffer {
                pre_lock_creation_txid,
            } => CliPreLock::cancel_pre_lock(context, *pre_lock_creation_txid),
        }
    }

    fn create_pre_lock(
        context: CliContext,
        utility_nfts_issuance_txid: Txid,
        collateral_asset_id_hex_be: &str,
        principal_asset_id_hex_be: &str,
    ) -> Result<(), PreLockCommandError> {
        let utility_nfts_tx = context
            .esplora_provider
            .fetch_transaction(&utility_nfts_issuance_txid)?;
        let first_parameters_nft_asset_id = utility_nfts_tx.output[0]
            .asset
            .explicit()
            .expect("Utility NFT must be explicit");
        let second_parameters_nft_asset_id = utility_nfts_tx.output[1]
            .asset
            .explicit()
            .expect("Utility NFT must be explicit");
        let borrower_nft_asset_id = utility_nfts_tx.output[2]
            .asset
            .explicit()
            .expect("Utility NFT must be explicit");
        let lender_nft_asset_id = utility_nfts_tx.output[3]
            .asset
            .explicit()
            .expect("Utility NFT must be explicit");

        let first_parameters_nft_amount = utility_nfts_tx.output[0]
            .value
            .explicit()
            .expect("Parameter NFT must have explicit amount");
        let second_parameters_nft_amount = utility_nfts_tx.output[1]
            .value
            .explicit()
            .expect("Parameter NFT must have explicit amount");

        let offer_parameters = LendingOfferParameters::build_from_parameters_nfts(
            &FirstNFTParameters::decode(first_parameters_nft_amount),
            &SecondNFTParameters::decode(second_parameters_nft_amount),
        );

        let collateral_asset_id = AssetId::from_str(collateral_asset_id_hex_be)?;
        let principal_asset_id = AssetId::from_str(principal_asset_id_hex_be)?;
        let borrower_script = context.signer.get_address().script_pubkey();

        let pre_lock_parameters = PreLockParameters {
            collateral_asset_id,
            principal_asset_id,
            first_parameters_nft_asset_id,
            second_parameters_nft_asset_id,
            borrower_nft_asset_id,
            lender_nft_asset_id,
            offer_parameters,
            borrower_pubkey: context.signer.get_schnorr_public_key(),
            borrower_output_script_hash: hash_script(&borrower_script),
            network: context.get_network(),
        };

        let collateral_utxos = context.signer.get_utxos_filter(
            &|utxo| {
                utxo.explicit_asset() == pre_lock_parameters.collateral_asset_id
                    && utxo.txout.value.explicit().unwrap_or(0)
                        >= pre_lock_parameters.offer_parameters.collateral_amount
            },
            &|_| true,
        )?;

        if collateral_utxos.is_empty() {
            return Err(PreLockCommandError::NoCollateralUTXOsFound(
                pre_lock_parameters.offer_parameters.collateral_amount,
            ));
        }

        let pre_lock = PreLock::new(pre_lock_parameters);

        let collateral_utxo = collateral_utxos[0].clone();
        let first_parameters_utxo = UTXO {
            outpoint: OutPoint::new(utility_nfts_issuance_txid, 0),
            txout: utility_nfts_tx.output[0].clone(),
            secrets: None,
        };
        let second_parameters_utxo = UTXO {
            outpoint: OutPoint::new(utility_nfts_issuance_txid, 1),
            txout: utility_nfts_tx.output[1].clone(),
            secrets: None,
        };
        let borrower_nft_utxo = UTXO {
            outpoint: OutPoint::new(utility_nfts_issuance_txid, 2),
            txout: utility_nfts_tx.output[2].clone(),
            secrets: None,
        };
        let lender_nft_utxo = UTXO {
            outpoint: OutPoint::new(utility_nfts_issuance_txid, 3),
            txout: utility_nfts_tx.output[3].clone(),
            secrets: None,
        };

        let mut ft = FinalTransaction::new();

        ft.add_input(
            PartialInput::new(collateral_utxo.clone()),
            RequiredSignature::NativeEcdsa,
        );
        ft.add_input(
            PartialInput::new(first_parameters_utxo.clone()),
            RequiredSignature::NativeEcdsa,
        );
        ft.add_input(
            PartialInput::new(second_parameters_utxo.clone()),
            RequiredSignature::NativeEcdsa,
        );
        ft.add_input(
            PartialInput::new(borrower_nft_utxo.clone()),
            RequiredSignature::NativeEcdsa,
        );
        ft.add_input(
            PartialInput::new(lender_nft_utxo.clone()),
            RequiredSignature::NativeEcdsa,
        );

        pre_lock.attach_creation(&mut ft, 1);

        println!(
            "Creating Lending offer with next parameters: {:?}",
            pre_lock_parameters,
        );

        let (tx, _) = context.signer.finalize(&ft)?;
        let txid = context.esplora_provider.broadcast_transaction(&tx)?;

        println!("Lending offer successfully created!");
        println!("Broadcast txid: {txid}");

        Ok(())
    }

    fn create_lending_from_pre_lock(
        context: CliContext,
        pre_lock_creation_txid: Txid,
    ) -> Result<(), PreLockCommandError> {
        let pre_lock_creation_tx = context
            .esplora_provider
            .fetch_transaction(&pre_lock_creation_txid)?;

        let pre_lock = PreLock::try_from_tx(&pre_lock_creation_tx, &context.esplora_provider)?;
        let pre_lock_parameters = pre_lock.get_parameters();

        let principal_utxos = context
            .signer
            .get_utxos_asset(pre_lock_parameters.principal_asset_id)?;

        let mut principal_inputs: Vec<(UTXO, RequiredSignature)> = Vec::new();
        let mut total_principal_inputs_amount = 0;

        for utxo in principal_utxos {
            total_principal_inputs_amount += utxo.explicit_amount();
            principal_inputs.push((utxo, RequiredSignature::NativeEcdsa));

            if total_principal_inputs_amount
                >= pre_lock_parameters.offer_parameters.principal_amount
            {
                break;
            }
        }

        if total_principal_inputs_amount < pre_lock_parameters.offer_parameters.principal_amount {
            return Err(PreLockCommandError::NotEnoughPrincipalToAcceptOffer {
                expected_amount: pre_lock_parameters.offer_parameters.principal_amount,
                actual_amount: total_principal_inputs_amount,
            });
        }

        let prev_collateral_outpoint = pre_lock_creation_tx.input[0].previous_output;
        let pre_collateral_tx = context
            .esplora_provider
            .fetch_transaction(&prev_collateral_outpoint.txid)?;
        let borrower_output_script =
            &pre_collateral_tx.output[prev_collateral_outpoint.vout as usize].script_pubkey;

        let pre_lock_utxo = UTXO {
            outpoint: OutPoint::new(pre_lock_creation_txid, 0),
            txout: pre_lock_creation_tx.output[0].clone(),
            secrets: None,
        };
        let first_parameters_nft_utxo = UTXO {
            outpoint: OutPoint::new(pre_lock_creation_txid, 1),
            txout: pre_lock_creation_tx.output[1].clone(),
            secrets: None,
        };
        let second_parameters_nft_utxo = UTXO {
            outpoint: OutPoint::new(pre_lock_creation_txid, 2),
            txout: pre_lock_creation_tx.output[2].clone(),
            secrets: None,
        };
        let borrower_nft_utxo = UTXO {
            outpoint: OutPoint::new(pre_lock_creation_txid, 3),
            txout: pre_lock_creation_tx.output[3].clone(),
            secrets: None,
        };
        let lender_nft_utxo = UTXO {
            outpoint: OutPoint::new(pre_lock_creation_txid, 4),
            txout: pre_lock_creation_tx.output[4].clone(),
            secrets: None,
        };

        let mut ft = FinalTransaction::new();

        pre_lock.attach_lending_creation(
            &mut ft,
            pre_lock_utxo,
            first_parameters_nft_utxo,
            second_parameters_nft_utxo,
            borrower_nft_utxo,
            lender_nft_utxo,
        );

        for input in principal_inputs {
            ft.add_input(PartialInput::new(input.0), input.1);
        }

        ft.add_output(PartialOutput::new(
            borrower_output_script.clone(),
            1,
            pre_lock_parameters.borrower_nft_asset_id,
        ));

        ft.add_output(PartialOutput::new(
            context.signer.get_address().script_pubkey(),
            1,
            pre_lock_parameters.lender_nft_asset_id,
        ));

        ft.add_output(PartialOutput::new(
            borrower_output_script.clone(),
            pre_lock_parameters.offer_parameters.principal_amount,
            pre_lock_parameters.principal_asset_id,
        ));

        if total_principal_inputs_amount > pre_lock_parameters.offer_parameters.principal_amount {
            ft.add_output(PartialOutput::new(
                context.signer.get_address().script_pubkey(),
                total_principal_inputs_amount
                    - pre_lock_parameters.offer_parameters.principal_amount,
                pre_lock_parameters.principal_asset_id,
            ));
        }

        println!("Activating Lending offer...");

        let (tx, _) = context.signer.finalize(&ft)?;
        let txid = context.esplora_provider.broadcast_transaction(&tx)?;

        println!("Lending offer successfully activated!");
        println!("Broadcast txid: {txid}");

        Ok(())
    }

    fn cancel_pre_lock(
        context: CliContext,
        pre_lock_creation_txid: Txid,
    ) -> Result<(), PreLockCommandError> {
        let pre_lock_creation_tx = context
            .esplora_provider
            .fetch_transaction(&pre_lock_creation_txid)?;

        let pre_lock = PreLock::try_from_tx(&pre_lock_creation_tx, &context.esplora_provider)?;
        let pre_lock_parameters = pre_lock.get_parameters();

        let pre_lock_utxo = UTXO {
            outpoint: OutPoint::new(pre_lock_creation_txid, 0),
            txout: pre_lock_creation_tx.output[0].clone(),
            secrets: None,
        };
        let first_parameters_nft_utxo = UTXO {
            outpoint: OutPoint::new(pre_lock_creation_txid, 1),
            txout: pre_lock_creation_tx.output[1].clone(),
            secrets: None,
        };
        let second_parameters_nft_utxo = UTXO {
            outpoint: OutPoint::new(pre_lock_creation_txid, 2),
            txout: pre_lock_creation_tx.output[2].clone(),
            secrets: None,
        };
        let borrower_nft_utxo = UTXO {
            outpoint: OutPoint::new(pre_lock_creation_txid, 3),
            txout: pre_lock_creation_tx.output[3].clone(),
            secrets: None,
        };
        let lender_nft_utxo = UTXO {
            outpoint: OutPoint::new(pre_lock_creation_txid, 4),
            txout: pre_lock_creation_tx.output[4].clone(),
            secrets: None,
        };

        let mut ft = FinalTransaction::new();

        ft.add_output(PartialOutput::new(
            context.signer.get_address().script_pubkey(),
            pre_lock_parameters.offer_parameters.collateral_amount,
            pre_lock_parameters.collateral_asset_id,
        ));

        pre_lock.attach_cancellation(
            &mut ft,
            pre_lock_utxo,
            first_parameters_nft_utxo,
            second_parameters_nft_utxo,
            borrower_nft_utxo,
            lender_nft_utxo,
        );

        println!("Cancelling Lending offer...");

        let (tx, _) = context.signer.finalize(&ft)?;
        let txid = context.esplora_provider.broadcast_transaction(&tx)?;

        println!("Lending offer successfully cancelled!");
        println!("Broadcast txid: {txid}");

        Ok(())
    }
}
