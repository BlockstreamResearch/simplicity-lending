use simplex::{
    program::Program,
    provider::SimplicityNetwork,
    simplicityhl::elements::{LockTime, Script, Sequence},
    transaction::{FinalTransaction, PartialInput, PartialOutput, UTXO},
};

use crate::programs::{
    lending::{LendingParameters, LendingWitnessBranch},
    ownable_script_auth::{OwnableScriptAuth, OwnableScriptAuthParameters},
    program::SimplexProgram,
};
use crate::{
    artifacts::lending::LendingProgram, programs::lending::params::LendingOfferRepaymentPhase,
};

pub struct Lending {
    program: LendingProgram,
    parameters: LendingParameters,
}

impl Lending {
    pub fn new(parameters: LendingParameters) -> Self {
        Self {
            program: LendingProgram::new(parameters.build_arguments()),
            parameters,
        }
    }

    pub fn get_parameters(&self) -> &LendingParameters {
        &self.parameters
    }

    pub fn attach_creation(&self, ft: &mut FinalTransaction) {
        self.add_program_output(
            ft,
            self.parameters.collateral_asset_id,
            self.parameters.collateral_amount,
        );
    }

    pub fn attach_full_repayment(
        &self,
        ft: &mut FinalTransaction,
        lending_utxo: UTXO,
        borrower_debt_nft_utxo: UTXO,
        lender_vault_utxo: Option<UTXO>,
        protocol_fee_vault_utxo: Option<UTXO>,
    ) {
        let current_borrower_debt = borrower_debt_nft_utxo.explicit_amount();

        self.attach_partial_repayment(
            ft,
            lending_utxo,
            borrower_debt_nft_utxo,
            lender_vault_utxo,
            protocol_fee_vault_utxo,
            current_borrower_debt,
        );
    }

    pub fn attach_partial_repayment(
        &self,
        ft: &mut FinalTransaction,
        lending_utxo: UTXO,
        borrower_debt_nft_utxo: UTXO,
        lender_vault_utxo: Option<UTXO>,
        protocol_fee_vault_utxo: Option<UTXO>,
        amount_to_repay: u64,
    ) {
        let lending_input_index = ft.n_inputs() as u32;
        let borrower_debt_nft_input_index = lending_input_index + 1;

        self.add_program_input(
            ft,
            lending_utxo,
            LendingWitnessBranch::PartialLoanRepayment { amount_to_repay }.build_witness(),
        );

        let current_borrower_debt = borrower_debt_nft_utxo.explicit_amount();

        if amount_to_repay < current_borrower_debt {
            self.add_program_output(
                ft,
                self.parameters.collateral_asset_id,
                self.parameters.collateral_amount,
            );
        }

        let borrower_debt_nft_output_index = ft.n_outputs() as u32;

        self.attach_borrower_debt_nft(
            ft,
            borrower_debt_nft_utxo,
            lending_input_index,
            amount_to_repay,
        );

        self.attach_vaults(
            ft,
            lender_vault_utxo,
            protocol_fee_vault_utxo,
            (
                borrower_debt_nft_input_index,
                borrower_debt_nft_output_index,
            ),
            current_borrower_debt,
            amount_to_repay,
        );
    }

    pub fn attach_loan_liquidation(
        &self,
        ft: &mut FinalTransaction,
        lending_utxo: UTXO,
        borrower_debt_nft_utxo: UTXO,
    ) {
        let lending_input_index = ft.n_inputs() as u32;

        let locktime = LockTime::from_height(self.parameters.loan_expiration_time).unwrap();

        let lending_input = PartialInput::new(lending_utxo)
            .with_sequence(Sequence::ENABLE_LOCKTIME_NO_RBF)
            .with_locktime(locktime);

        self.add_program_input_from_partial_input(
            ft,
            lending_input,
            LendingWitnessBranch::LoanLiquidation.build_witness(),
        );

        let current_borrower_debt = borrower_debt_nft_utxo.explicit_amount();

        self.attach_borrower_debt_nft(
            ft,
            borrower_debt_nft_utxo,
            lending_input_index,
            current_borrower_debt,
        );

        ft.add_output(PartialOutput::new(
            Script::new_op_return(b"burn"),
            1,
            self.parameters.lender_nft_asset_id,
        ));
    }

    fn attach_borrower_debt_nft(
        &self,
        ft: &mut FinalTransaction,
        borrower_debt_nft_utxo: UTXO,
        lending_input_index: u32,
        amount_to_burn: u64,
    ) {
        let current_borrower_debt = borrower_debt_nft_utxo.explicit_amount();

        assert!(
            amount_to_burn <= current_borrower_debt,
            "Passed amount to burn {amount_to_burn} higher than the debt amount {current_borrower_debt}"
        );

        let borrower_debt_nft_script_auth = OwnableScriptAuth::new(OwnableScriptAuthParameters {
            owner_pubkey: self.parameters.borrower_pubkey,
            script_hash: self.get_script_hash(),
            network: self.parameters.network,
        });

        borrower_debt_nft_script_auth.attach_unlocking(
            ft,
            borrower_debt_nft_utxo,
            lending_input_index,
        );

        if amount_to_burn < current_borrower_debt {
            borrower_debt_nft_script_auth.attach_creation(
                ft,
                self.parameters.borrower_debt_nft_asset_id,
                current_borrower_debt - amount_to_burn,
            );
        }

        ft.add_output(PartialOutput::new(
            Script::new_op_return(b"burn"),
            amount_to_burn,
            self.parameters.borrower_debt_nft_asset_id,
        ));
    }

    fn attach_vaults(
        &self,
        ft: &mut FinalTransaction,
        lender_vault_utxo: Option<UTXO>,
        protocol_fee_vault_utxo: Option<UTXO>,
        borrower_debt_nft_indexes: (u32, u32),
        current_borrower_debt: u64,
        amount_to_repay: u64,
    ) {
        match self.parameters.get_repayment_phase(current_borrower_debt) {
            LendingOfferRepaymentPhase::NoRepayments => {
                self.attach_vaults_for_no_repayments_phase(
                    ft,
                    current_borrower_debt,
                    amount_to_repay,
                );
            }
            LendingOfferRepaymentPhase::RepayingOfferFee => {
                self.attach_vaults_for_repaying_offer_fee_phase(
                    ft,
                    lender_vault_utxo.unwrap(),
                    protocol_fee_vault_utxo.unwrap(),
                    (borrower_debt_nft_indexes.0, borrower_debt_nft_indexes.1),
                    current_borrower_debt,
                    amount_to_repay,
                );
            }
            LendingOfferRepaymentPhase::RepayingPrincipal => {
                self.attach_vaults_for_repaying_principal_phase(
                    ft,
                    lender_vault_utxo.unwrap(),
                    (borrower_debt_nft_indexes.0, borrower_debt_nft_indexes.1),
                    current_borrower_debt,
                    amount_to_repay,
                );
            }
            LendingOfferRepaymentPhase::Repaid => {}
        }
    }

    fn attach_vaults_for_no_repayments_phase(
        &self,
        ft: &mut FinalTransaction,
        current_borrower_debt: u64,
        amount_to_repay: u64,
    ) {
        let repaid_protocol_fee = self
            .parameters
            .get_repaid_protocol_fee(current_borrower_debt, amount_to_repay);

        if amount_to_repay < current_borrower_debt {
            self.parameters
                .get_active_lender_vault()
                .attach_creation(ft, amount_to_repay - repaid_protocol_fee);
        } else {
            self.parameters
                .get_finalized_lender_vault()
                .attach_creation(ft, amount_to_repay - repaid_protocol_fee);
        }

        if repaid_protocol_fee < self.parameters.get_total_protocol_fee() {
            self.parameters
                .get_active_protocol_fee_vault()
                .attach_creation(ft, repaid_protocol_fee);
        } else {
            self.parameters
                .get_finalized_protocol_fee_vault()
                .attach_creation(ft, repaid_protocol_fee);
        }
    }

    fn attach_vaults_for_repaying_offer_fee_phase(
        &self,
        ft: &mut FinalTransaction,
        lender_vault_utxo: UTXO,
        protocol_fee_vault_utxo: UTXO,
        borrower_debt_nft_indexes: (u32, u32),
        current_borrower_debt: u64,
        amount_to_repay: u64,
    ) {
        let repaid_protocol_fee = self
            .parameters
            .get_repaid_protocol_fee(current_borrower_debt, amount_to_repay);
        let protocol_fee_left = self
            .parameters
            .get_protocol_fee_to_repay(current_borrower_debt);

        let active_lender_vault = self.parameters.get_active_lender_vault();
        let active_protocol_fee_vault = self.parameters.get_active_protocol_fee_vault();

        active_lender_vault.attach_supplying_with_goal(
            ft,
            lender_vault_utxo,
            borrower_debt_nft_indexes.0,
            borrower_debt_nft_indexes.1,
            amount_to_repay - repaid_protocol_fee,
            current_borrower_debt,
        );

        active_protocol_fee_vault.attach_supplying_with_goal(
            ft,
            protocol_fee_vault_utxo,
            borrower_debt_nft_indexes.0,
            borrower_debt_nft_indexes.1,
            repaid_protocol_fee,
            protocol_fee_left,
        );
    }

    fn attach_vaults_for_repaying_principal_phase(
        &self,
        ft: &mut FinalTransaction,
        lender_vault_utxo: UTXO,
        borrower_debt_nft_indexes: (u32, u32),
        current_borrower_debt: u64,
        amount_to_repay: u64,
    ) {
        let active_lender_vault = self.parameters.get_active_lender_vault();

        active_lender_vault.attach_supplying_with_goal(
            ft,
            lender_vault_utxo,
            borrower_debt_nft_indexes.0,
            borrower_debt_nft_indexes.1,
            amount_to_repay,
            current_borrower_debt,
        );
    }
}

impl SimplexProgram for Lending {
    fn get_program(&self) -> &Program {
        self.program.as_ref()
    }

    fn get_network(&self) -> &SimplicityNetwork {
        &self.parameters.network
    }

    fn get_program_source_code(&self) -> &'static str {
        LendingProgram::SOURCE
    }
}
