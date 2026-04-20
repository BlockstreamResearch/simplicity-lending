use simplex::{
    program::Program,
    provider::SimplicityNetwork,
    simplicityhl::elements::{LockTime, Script, Sequence},
    transaction::{FinalTransaction, PartialInput, PartialOutput, UTXO},
};

use crate::artifacts::lending::LendingProgram;
use crate::programs::{
    lending::{LendingParameters, LendingWitnessBranch},
    program::SimplexProgram,
    script_auth::{ScriptAuth, ScriptAuthWitnessParams},
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

    pub fn attach_creation(
        &self,
        ft: &mut FinalTransaction,
        first_parameters_nft_utxo: UTXO,
        second_parameters_nft_utxo: UTXO,
    ) {
        self.add_program_output(
            ft,
            self.parameters.collateral_asset_id,
            self.parameters.offer_parameters.collateral_amount,
        );

        let parameter_nfts_script_auth = ScriptAuth::from_simplex_program(self);
        let first_parameters_nft_amount = first_parameters_nft_utxo.explicit_amount();
        let second_parameters_nft_amount = second_parameters_nft_utxo.explicit_amount();

        parameter_nfts_script_auth.attach_creation(
            ft,
            self.parameters.first_parameters_nft_asset_id,
            first_parameters_nft_amount,
        );
        parameter_nfts_script_auth.attach_creation(
            ft,
            self.parameters.second_parameters_nft_asset_id,
            second_parameters_nft_amount,
        );
    }

    pub fn attach_loan_repayment(
        &self,
        ft: &mut FinalTransaction,
        lending_utxo: UTXO,
        first_parameters_nft_utxo: UTXO,
        second_parameters_nft_utxo: UTXO,
    ) {
        let first_parameters_nft_amount = first_parameters_nft_utxo.explicit_amount();
        let second_parameters_nft_amount = second_parameters_nft_utxo.explicit_amount();
        let lending_input_index = ft.n_inputs() as u32;

        self.add_program_input(
            ft,
            lending_utxo,
            LendingWitnessBranch::LoanRepayment.build_witness(),
        );

        let parameters_script_auth = ScriptAuth::from_simplex_program(self);
        let parameters_script_auth_witness = ScriptAuthWitnessParams::new(lending_input_index);

        parameters_script_auth.attach_unlocking(
            ft,
            first_parameters_nft_utxo,
            parameters_script_auth_witness,
        );
        parameters_script_auth.attach_unlocking(
            ft,
            second_parameters_nft_utxo,
            parameters_script_auth_witness,
        );

        let principal_with_interest = self
            .parameters
            .offer_parameters
            .calculate_principal_with_interest();
        let lender_principal_asset_auth = self.parameters.get_lender_principal_asset_auth();

        lender_principal_asset_auth.add_program_output(
            ft,
            self.parameters.principal_asset_id,
            principal_with_interest,
        );

        ft.add_output(PartialOutput::new(
            Script::new_op_return(b"burn"),
            first_parameters_nft_amount,
            self.parameters.first_parameters_nft_asset_id,
        ));

        ft.add_output(PartialOutput::new(
            Script::new_op_return(b"burn"),
            second_parameters_nft_amount,
            self.parameters.second_parameters_nft_asset_id,
        ));

        ft.add_output(PartialOutput::new(
            Script::new_op_return(b"burn"),
            1,
            self.parameters.borrower_nft_asset_id,
        ));
    }

    pub fn attach_loan_liquidation(
        &self,
        ft: &mut FinalTransaction,
        program_utxo: UTXO,
        first_parameters_nft_utxo: UTXO,
        second_parameters_nft_utxo: UTXO,
    ) {
        let first_parameters_nft_amount = first_parameters_nft_utxo.explicit_amount();
        let second_parameters_nft_amount = second_parameters_nft_utxo.explicit_amount();
        let lending_input_index = ft.n_inputs() as u32;

        let locktime =
            LockTime::from_height(self.parameters.offer_parameters.loan_expiration_time).unwrap();

        let lending_input = PartialInput::new(program_utxo)
            .with_sequence(Sequence::ENABLE_LOCKTIME_NO_RBF)
            .with_locktime(locktime);

        self.add_program_input_from_partial_input(
            ft,
            lending_input,
            LendingWitnessBranch::LoanLiquidation.build_witness(),
        );

        let parameters_script_auth = ScriptAuth::from_simplex_program(self);
        let parameters_script_auth_witness = ScriptAuthWitnessParams::new(lending_input_index);

        parameters_script_auth.attach_unlocking(
            ft,
            first_parameters_nft_utxo,
            parameters_script_auth_witness,
        );
        parameters_script_auth.attach_unlocking(
            ft,
            second_parameters_nft_utxo,
            parameters_script_auth_witness,
        );

        ft.add_output(PartialOutput::new(
            Script::new_op_return(b"burn"),
            first_parameters_nft_amount,
            self.parameters.first_parameters_nft_asset_id,
        ));

        ft.add_output(PartialOutput::new(
            Script::new_op_return(b"burn"),
            second_parameters_nft_amount,
            self.parameters.second_parameters_nft_asset_id,
        ));

        ft.add_output(PartialOutput::new(
            Script::new_op_return(b"burn"),
            1,
            self.parameters.lender_nft_asset_id,
        ));
    }
}

impl SimplexProgram for Lending {
    fn get_program(&self) -> &Program {
        self.program.get_program()
    }

    fn get_network(&self) -> &SimplicityNetwork {
        &self.parameters.network
    }
}
