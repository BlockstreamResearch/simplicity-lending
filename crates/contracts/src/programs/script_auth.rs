use simplex::program::Program;
use simplex::simplicityhl::elements::secp256k1_zkp::XOnlyPublicKey;
use simplex::{provider::SimplicityNetwork, utils::tr_unspendable_key};

use crate::artifacts::script_auth::derived_script_auth::ScriptAuthWitness;
use crate::artifacts::script_auth::{ScriptAuthProgram, derived_script_auth::ScriptAuthArguments};
use crate::programs::program::SimplexProgram;

pub struct ScriptAuth {
    program: ScriptAuthProgram,
    network: SimplicityNetwork,
}

impl ScriptAuth {
    pub fn new(arguments: ScriptAuthArguments, network: SimplicityNetwork) -> ScriptAuth {
        Self::from_internal_key(tr_unspendable_key(), arguments, network)
    }

    pub fn from_internal_key(
        internal_key: XOnlyPublicKey,
        arguments: ScriptAuthArguments,
        network: SimplicityNetwork,
    ) -> ScriptAuth {
        ScriptAuth {
            program: ScriptAuthProgram::new(internal_key, arguments),
            network,
        }
    }

    pub fn get_script_auth_witness(input_script_index: u32) -> ScriptAuthWitness {
        ScriptAuthWitness {
            input_script_index: input_script_index,
        }
    }
}

impl SimplexProgram for ScriptAuth {
    fn get_program(&self) -> &Program {
        self.program.get_program()
    }

    fn get_network(&self) -> &SimplicityNetwork {
        &self.network
    }
}
