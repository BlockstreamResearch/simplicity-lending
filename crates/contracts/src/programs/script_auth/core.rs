use simplex::{
    program::Program,
    provider::SimplicityNetwork,
    simplicityhl::elements::AssetId,
    transaction::{FinalTransaction, UTXO},
};

use crate::{
    artifacts::script_auth::ScriptAuthProgram, programs::script_auth::ScriptAuthWitnessParams,
};

use crate::programs::program::SimplexProgram;
use crate::programs::script_auth::ScriptAuthParameters;

pub struct ScriptAuth {
    program: ScriptAuthProgram,
    parameters: ScriptAuthParameters,
}

impl ScriptAuth {
    pub fn new(parameters: ScriptAuthParameters) -> Self {
        Self {
            program: ScriptAuthProgram::new(parameters.build_arguments()),
            parameters,
        }
    }

    pub fn from_simplex_program(program: &impl SimplexProgram) -> Self {
        Self::new(ScriptAuthParameters {
            script_hash: program.get_script_hash(),
            network: *program.get_network(),
        })
    }

    pub fn get_parameters(&self) -> &ScriptAuthParameters {
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
        witness_params: ScriptAuthWitnessParams,
    ) {
        self.add_program_input(ft, program_utxo, witness_params.build_witness());
    }
}

impl SimplexProgram for ScriptAuth {
    fn get_program(&self) -> &Program {
        self.program.as_ref()
    }

    fn get_network(&self) -> &SimplicityNetwork {
        &self.parameters.network
    }

    fn get_program_source_code(&self) -> &'static str {
        ScriptAuthProgram::SOURCE
    }
}
