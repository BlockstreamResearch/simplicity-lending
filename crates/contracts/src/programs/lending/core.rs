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
    script_auth::{ScriptAuth, ScriptAuthSchema, ScriptAuthWitnessParams},
};

pub struct Lending {
    program: LendingProgram,
    parameters: LendingParameters,
}

#[derive(Debug, Clone)]
pub enum LendingSchema {
    Create {
        first_parameters_nft_utxo: UTXO,
        second_parameters_nft_utxo: UTXO,
    },
    Repay {
        program_utxo: UTXO,
        first_parameters_nft_utxo: UTXO,
        second_parameters_nft_utxo: UTXO,
    },
    Liquidate {
        program_utxo: UTXO,
        first_parameters_nft_utxo: UTXO,
        second_parameters_nft_utxo: UTXO,
    },
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

    pub fn use_schema(&self, ft: &mut FinalTransaction, schema: LendingSchema) {
        match schema {
            LendingSchema::Create {
                first_parameters_nft_utxo,
                second_parameters_nft_utxo,
            } => {
                self.use_creation_schema(ft, first_parameters_nft_utxo, second_parameters_nft_utxo)
            }
            LendingSchema::Repay {
                program_utxo,
                first_parameters_nft_utxo,
                second_parameters_nft_utxo,
            } => self.use_repayment_schema(
                ft,
                program_utxo,
                first_parameters_nft_utxo,
                second_parameters_nft_utxo,
            ),
            LendingSchema::Liquidate {
                program_utxo,
                first_parameters_nft_utxo,
                second_parameters_nft_utxo,
            } => self.use_liquidation_schema(
                ft,
                program_utxo,
                first_parameters_nft_utxo,
                second_parameters_nft_utxo,
            ),
        }
    }

    fn use_creation_schema(
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

        parameter_nfts_script_auth.add_program_output(
            ft,
            self.parameters.first_parameters_nft_asset_id,
            first_parameters_nft_amount,
        );
        parameter_nfts_script_auth.add_program_output(
            ft,
            self.parameters.second_parameters_nft_asset_id,
            second_parameters_nft_amount,
        );
    }

    fn use_repayment_schema(
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

        parameters_script_auth.use_schema(
            ft,
            ScriptAuthSchema::Unlock {
                program_utxo: first_parameters_nft_utxo,
                witness_params: parameters_script_auth_witness,
            },
        );
        parameters_script_auth.use_schema(
            ft,
            ScriptAuthSchema::Unlock {
                program_utxo: second_parameters_nft_utxo,
                witness_params: parameters_script_auth_witness,
            },
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

    fn use_liquidation_schema(
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

        parameters_script_auth.use_schema(
            ft,
            ScriptAuthSchema::Unlock {
                program_utxo: first_parameters_nft_utxo,
                witness_params: parameters_script_auth_witness,
            },
        );
        parameters_script_auth.use_schema(
            ft,
            ScriptAuthSchema::Unlock {
                program_utxo: second_parameters_nft_utxo,
                witness_params: parameters_script_auth_witness,
            },
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
