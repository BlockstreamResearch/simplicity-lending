use simplex::{
    program::Program,
    provider::SimplicityNetwork,
    simplicityhl::elements::AssetId,
    transaction::{FinalTransaction, UTXO},
};

use crate::artifacts::asset_auth::AssetAuthProgram;

use crate::programs::asset_auth::{AssetAuthParameters, AssetAuthWitnessParams};
use crate::programs::program::SimplexProgram;

pub struct AssetAuth {
    program: AssetAuthProgram,
    parameters: AssetAuthParameters,
}

impl AssetAuth {
    pub fn new(parameters: AssetAuthParameters) -> Self {
        Self {
            program: AssetAuthProgram::new(parameters.build_arguments()),
            parameters,
        }
    }

    pub fn get_parameters(&self) -> &AssetAuthParameters {
        &self.parameters
    }

    pub fn attach_creation(
        &self,
        ft: &mut FinalTransaction,
        asset_id_to_lock: AssetId,
        amount_to_lock: u64,
    ) {
        self.add_program_output(ft, asset_id_to_lock, amount_to_lock);
    }

    pub fn attach_unlocking(
        &self,
        ft: &mut FinalTransaction,
        program_utxo: UTXO,
        witness_params: AssetAuthWitnessParams,
    ) {
        self.add_program_input(ft, program_utxo, witness_params.build_witness());
    }
}

impl SimplexProgram for AssetAuth {
    fn get_program(&self) -> &Program {
        self.program.as_ref()
    }

    fn get_network(&self) -> &SimplicityNetwork {
        &self.parameters.network
    }

    fn get_program_source_code(&self) -> &'static str {
        AssetAuthProgram::SOURCE
    }
}
