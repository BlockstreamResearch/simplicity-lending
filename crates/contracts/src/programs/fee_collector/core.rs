use simplex::{
    program::Program,
    provider::SimplicityNetwork,
    simplicityhl::elements::AssetId,
    transaction::{FinalTransaction, RequiredSignature, UTXO},
};

use crate::artifacts::fee_collector::FeeCollectorProgram;
use crate::programs::fee_collector::{FeeCollectorParameters, FeeCollectorWitnessBranch};
use crate::programs::program::SimplexProgram;

pub struct FeeCollector {
    program: FeeCollectorProgram,
    parameters: FeeCollectorParameters,
}

impl FeeCollector {
    pub fn new(parameters: FeeCollectorParameters) -> Self {
        Self {
            program: FeeCollectorProgram::new(&parameters.build_arguments()),
            parameters,
        }
    }

    pub fn get_parameters(&self) -> &FeeCollectorParameters {
        &self.parameters
    }

    pub fn attach_creation(&self, ft: &mut FinalTransaction, asset_id: AssetId, amount: u64) {
        self.add_program_output(ft, asset_id, amount);
    }

    pub fn attach_deposit(
        &self,
        ft: &mut FinalTransaction,
        program_utxo: UTXO,
        additional_amount: u64,
    ) {
        assert!(additional_amount > 0, "Invalid amount to deposit");

        let output_index = ft.n_outputs() as u32;
        let asset_id = program_utxo.explicit_asset();
        let new_amount = program_utxo
            .explicit_amount()
            .checked_add(additional_amount)
            .expect("Deposit amount overflow");

        let deposit_witness_branch = FeeCollectorWitnessBranch::Deposit {
            output_index,
            additional_amount,
        };

        self.add_program_input(ft, program_utxo, deposit_witness_branch.build_witness());
        self.add_program_output(ft, asset_id, new_amount);
    }

    pub fn attach_withdrawal(&self, ft: &mut FinalTransaction, program_utxo: UTXO) {
        self.add_program_input_with_signature(
            ft,
            program_utxo,
            FeeCollectorWitnessBranch::Withdrawal.build_witness(),
            RequiredSignature::witness_with_path("PATH", ["Left"]),
        );
    }
}

impl SimplexProgram for FeeCollector {
    fn get_program_source_code() -> &'static str {
        FeeCollectorProgram::SOURCE
    }

    fn get_program(&self) -> &Program {
        self.program.as_ref()
    }

    fn get_network(&self) -> &SimplicityNetwork {
        &self.parameters.network
    }
}
