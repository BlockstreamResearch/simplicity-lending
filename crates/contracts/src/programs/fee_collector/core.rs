use simplex::{
    program::Program,
    provider::SimplicityNetwork,
    simplicityhl::elements::AssetId,
    transaction::{FinalTransaction, UTXO},
};

use crate::artifacts::fee_collector::FeeCollectorProgram;

use crate::programs::fee_collector::{FeeCollectorParameters, FeeCollectorWitnessParams};
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

    pub fn attach_deposit(&self, ft: &mut FinalTransaction, asset_id: AssetId, amount: u64) {
        self.add_program_output(ft, asset_id, amount);
    }

    pub fn attach_withdrawal(
        &self,
        ft: &mut FinalTransaction,
        program_utxo: UTXO,
        witness_params: FeeCollectorWitnessParams,
    ) {
        self.add_program_input(ft, program_utxo, witness_params.build_witness());
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
