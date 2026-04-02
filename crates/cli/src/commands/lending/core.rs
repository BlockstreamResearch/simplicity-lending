use clap::Subcommand;

use lending_contracts::programs::Lending;
use lending_contracts::transactions::asset_auth::unlock_asset_auth;
use lending_contracts::transactions::core::SimplexInput;
use lending_contracts::transactions::lending::{
    extract_lending_parameters_from_tx, liquidate_loan, repay_loan,
};
use simplex::provider::ProviderTrait;
use simplex::simplicityhl::elements::{OutPoint, Txid};
use simplex::transaction::{PartialOutput, RequiredSignature, UTXO};

use crate::cli::CliContext;
use crate::commands::lending::LendingCommandError;

#[derive(Debug, Subcommand)]
pub enum LendingCommand {
    Repay {
        /// Lending covenant creation txid
        #[arg(long = "lending-creation-txid")]
        lending_creation_txid: Txid,
    },
    Liquidate {
        /// Lending covenant creation txid
        #[arg(long = "lending-creation-txid")]
        lending_creation_txid: Txid,
    },
    Claim {
        /// Lending covenant creation txid
        #[arg(long = "lending-creation-txid")]
        lending_creation_txid: Txid,
        /// Lending covenant repayment txid
        #[arg(long = "lending-repayment-txid")]
        lending_repayment_txid: Txid,
    },
}

pub struct CliLending {}

impl CliLending {
    pub fn run(context: CliContext, command: &LendingCommand) -> Result<(), LendingCommandError> {
        match command {
            LendingCommand::Repay {
                lending_creation_txid,
            } => CliLending::repay_loan_offer_tx(context, *lending_creation_txid),
            LendingCommand::Liquidate {
                lending_creation_txid,
            } => CliLending::liquidate_loan_offer_tx(context, *lending_creation_txid),
            LendingCommand::Claim {
                lending_creation_txid,
                lending_repayment_txid,
            } => CliLending::claim_lender_principal_tx(
                context,
                *lending_creation_txid,
                *lending_repayment_txid,
            ),
        }
    }

    fn repay_loan_offer_tx(
        context: CliContext,
        lending_creation_txid: Txid,
    ) -> Result<(), LendingCommandError> {
        let lending_creation_tx = context
            .esplora_provider
            .fetch_transaction(&lending_creation_txid)?;

        let lending_parameters =
            extract_lending_parameters_from_tx(&lending_creation_tx, &context.esplora_provider)?;
        let lending = Lending::new(lending_parameters);

        let borrower_nft_utxos = context
            .signer
            .get_utxos_asset(lending_parameters.borrower_nft_asset_id)?;

        if borrower_nft_utxos.len() != 1 {
            return Err(LendingCommandError::NotABorrower(lending_creation_txid));
        }

        let borrower_nft_utxo = borrower_nft_utxos.first().unwrap();

        let principal_utxos = context
            .signer
            .get_utxos_asset(lending_parameters.principal_asset_id)?;

        let mut principal_inputs: Vec<SimplexInput> = Vec::new();
        let mut total_inputs_amount = 0;

        let principal_with_interest = lending_parameters
            .offer_parameters
            .calculate_principal_with_interest();

        for utxo in principal_utxos {
            let input = SimplexInput::new(&utxo, RequiredSignature::NativeEcdsa);

            total_inputs_amount += input.explicit_amount();
            principal_inputs.push(input);

            if total_inputs_amount >= principal_with_interest {
                break;
            }
        }

        if total_inputs_amount < principal_with_interest {
            return Err(LendingCommandError::NotEnoughPrincipalToRepay {
                expected_amount: principal_with_interest,
                actual_amount: total_inputs_amount,
            });
        }

        let ft = repay_loan(
            UTXO {
                outpoint: OutPoint::new(lending_creation_txid, 0),
                txout: lending_creation_tx.output[0].clone(),
                secrets: None,
            },
            UTXO {
                outpoint: OutPoint::new(lending_creation_txid, 2),
                txout: lending_creation_tx.output[2].clone(),
                secrets: None,
            },
            UTXO {
                outpoint: OutPoint::new(lending_creation_txid, 3),
                txout: lending_creation_tx.output[3].clone(),
                secrets: None,
            },
            &SimplexInput::new(borrower_nft_utxo, RequiredSignature::NativeEcdsa),
            principal_inputs,
            PartialOutput::new(
                context.signer.get_address().script_pubkey(),
                lending_parameters.offer_parameters.collateral_amount,
                lending_parameters.collateral_asset_id,
            ),
            lending,
        )?;

        println!("Repaying the loan...");

        let (tx, _) = context.signer.finalize(&ft)?;
        let txid = context.esplora_provider.broadcast_transaction(&tx)?;

        println!("Loan successfully repaid!");
        println!("Broadcast txid: {txid}");

        Ok(())
    }

    fn liquidate_loan_offer_tx(
        context: CliContext,
        lending_creation_txid: Txid,
    ) -> Result<(), LendingCommandError> {
        let lending_creation_tx = context
            .esplora_provider
            .fetch_transaction(&lending_creation_txid)?;

        let lending_parameters =
            extract_lending_parameters_from_tx(&lending_creation_tx, &context.esplora_provider)?;
        let lending = Lending::new(lending_parameters);

        let lender_nft_utxos = context
            .signer
            .get_utxos_asset(lending_parameters.lender_nft_asset_id)?;

        if lender_nft_utxos.len() != 1 {
            return Err(LendingCommandError::NotALender(lending_creation_txid));
        }

        let lender_nft_utxo = lender_nft_utxos.first().unwrap();

        let current_height = context.esplora_provider.fetch_tip_height()?;

        if current_height < lending_parameters.offer_parameters.loan_expiration_time {
            return Err(LendingCommandError::LiquidationTimeHasNotComeYet {
                needed_height: lending_parameters.offer_parameters.loan_expiration_time,
                current_height,
            });
        }

        let ft = liquidate_loan(
            UTXO {
                outpoint: OutPoint::new(lending_creation_txid, 0),
                txout: lending_creation_tx.output[0].clone(),
                secrets: None,
            },
            UTXO {
                outpoint: OutPoint::new(lending_creation_txid, 2),
                txout: lending_creation_tx.output[2].clone(),
                secrets: None,
            },
            UTXO {
                outpoint: OutPoint::new(lending_creation_txid, 3),
                txout: lending_creation_tx.output[3].clone(),
                secrets: None,
            },
            &SimplexInput::new(lender_nft_utxo, RequiredSignature::NativeEcdsa),
            PartialOutput::new(
                context.signer.get_address().script_pubkey(),
                lending_parameters.offer_parameters.collateral_amount,
                lending_parameters.collateral_asset_id,
            ),
            lending,
        )?;

        println!("Liquidating the loan...");

        let (tx, _) = context.signer.finalize(&ft)?;
        let txid = context.esplora_provider.broadcast_transaction(&tx)?;

        println!("Loan successfully liquidated!");
        println!("Broadcast txid: {txid}");

        Ok(())
    }

    fn claim_lender_principal_tx(
        context: CliContext,
        lending_creation_txid: Txid,
        lending_repayment_txid: Txid,
    ) -> Result<(), LendingCommandError> {
        let lending_creation_tx = context
            .esplora_provider
            .fetch_transaction(&lending_creation_txid)?;

        let lending_parameters =
            extract_lending_parameters_from_tx(&lending_creation_tx, &context.esplora_provider)?;

        let lender_nft_utxos = context
            .signer
            .get_utxos_asset(lending_parameters.lender_nft_asset_id)?;

        if lender_nft_utxos.len() != 1 {
            return Err(LendingCommandError::NotALender(lending_creation_txid));
        }

        let lender_nft_utxo = lender_nft_utxos.first().unwrap();

        let principal_asset_auth = lending_parameters.get_lender_principal_asset_auth();
        let principal_with_interest = lending_parameters
            .offer_parameters
            .calculate_principal_with_interest();

        let lending_repayment_tx = context
            .esplora_provider
            .fetch_transaction(&lending_repayment_txid)?;

        let ft = unlock_asset_auth(
            UTXO {
                outpoint: OutPoint::new(lending_repayment_txid, 1),
                txout: lending_repayment_tx.output[1].clone(),
                secrets: None,
            },
            &SimplexInput::new(lender_nft_utxo, RequiredSignature::NativeEcdsa),
            PartialOutput::new(
                context.signer.get_address().script_pubkey(),
                principal_with_interest,
                lending_parameters.principal_asset_id,
            ),
            principal_asset_auth,
        );

        println!("Claiming principal with interest...");

        let (tx, _) = context.signer.finalize(&ft)?;
        let txid = context.esplora_provider.broadcast_transaction(&tx)?;

        println!("Principal assets successfully claimed!");
        println!("Broadcast txid: {txid}");

        Ok(())
    }
}
