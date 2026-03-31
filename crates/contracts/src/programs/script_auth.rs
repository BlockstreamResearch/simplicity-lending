use simplex::program::Program;
use simplex::simplicityhl::elements::secp256k1_zkp::XOnlyPublicKey;
use simplex::{provider::SimplicityNetwork, utils::tr_unspendable_key};

use crate::artifacts::script_auth::derived_script_auth::ScriptAuthWitness;
use crate::artifacts::script_auth::{ScriptAuthProgram, derived_script_auth::ScriptAuthArguments};
use crate::programs::program::{SimplexProgram, SimplexProgramError};

#[derive(Debug, Clone, Copy)]
pub struct ScriptAuthParameters {
    pub script_hash: [u8; 32],
    pub network: SimplicityNetwork,
}

impl From<ScriptAuthParameters> for ScriptAuthArguments {
    fn from(value: ScriptAuthParameters) -> Self {
        Self {
            script_hash: value.script_hash,
        }
    }
}

pub struct ScriptAuth {
    program: ScriptAuthProgram,
    parameters: ScriptAuthParameters,
}

impl ScriptAuth {
    pub fn new(parameters: ScriptAuthParameters) -> ScriptAuth {
        Self::from_internal_key(tr_unspendable_key(), parameters)
    }

    pub fn from_simplex_program(
        program: &impl SimplexProgram,
    ) -> Result<ScriptAuth, SimplexProgramError> {
        Ok(Self::new(ScriptAuthParameters {
            script_hash: program.get_script_hash()?,
            network: *program.get_network(),
        }))
    }

    pub fn from_internal_key(
        internal_key: XOnlyPublicKey,
        parameters: ScriptAuthParameters,
    ) -> ScriptAuth {
        ScriptAuth {
            program: ScriptAuthProgram::new(internal_key, ScriptAuthArguments::from(parameters)),
            parameters,
        }
    }

    pub fn get_script_auth_witness(input_script_index: u32) -> ScriptAuthWitness {
        ScriptAuthWitness { input_script_index }
    }

    pub fn get_script_auth_parameters(&self) -> &ScriptAuthParameters {
        &self.parameters
    }
}

impl SimplexProgram for ScriptAuth {
    fn get_program(&self) -> &Program {
        self.program.get_program()
    }

    fn get_network(&self) -> &SimplicityNetwork {
        &self.parameters.network
    }
}
