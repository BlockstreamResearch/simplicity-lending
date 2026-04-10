use simplex::constants::DUMMY_SIGNATURE;
use simplex::either::Either::{Left, Right};
use simplex::program::Program;
use simplex::provider::SimplicityNetwork;
use simplex::simplicityhl::elements::secp256k1_zkp::XOnlyPublicKey;

use crate::artifacts::ownable_script_auth::OwnableScriptAuthProgram;
use crate::artifacts::ownable_script_auth::derived_ownable_script_auth::{
    OwnableScriptAuthArguments, OwnableScriptAuthWitness,
};
use crate::programs::program::SimplexProgram;

#[derive(Debug, Clone, Copy)]
pub struct OwnableScriptAuthParameters {
    pub script_hash: [u8; 32],
    pub owner_pubkey: XOnlyPublicKey,
    pub network: SimplicityNetwork,
}

impl From<OwnableScriptAuthParameters> for OwnableScriptAuthArguments {
    fn from(value: OwnableScriptAuthParameters) -> Self {
        Self {
            script_hash: value.script_hash,
        }
    }
}

pub struct OwnableScriptAuth {
    program: OwnableScriptAuthProgram,
    parameters: OwnableScriptAuthParameters,
}

#[derive(Debug, Clone, Copy)]
pub enum OwnableScriptAuthBranch {
    OwnershipTransfer {
        current_owner: XOnlyPublicKey,
        new_owner: XOnlyPublicKey,
        program_output_index: u32,
    },
    ScriptAuthUnlock {
        owner: XOnlyPublicKey,
        input_script_index: u32,
    },
}

impl OwnableScriptAuth {
    pub fn new(parameters: OwnableScriptAuthParameters) -> Self {
        let mut program =
            OwnableScriptAuthProgram::new(OwnableScriptAuthArguments::from(parameters))
                .with_storage_capacity(1);

        program.set_storage_at(0, parameters.owner_pubkey.serialize());

        Self {
            program,
            parameters,
        }
    }

    pub fn get_ownable_script_auth_witness(
        witness_branch: &OwnableScriptAuthBranch,
    ) -> OwnableScriptAuthWitness {
        let path = match witness_branch {
            OwnableScriptAuthBranch::OwnershipTransfer {
                current_owner,
                new_owner,
                program_output_index,
            } => Left((
                current_owner.serialize(),
                new_owner.serialize(),
                *program_output_index,
            )),
            OwnableScriptAuthBranch::ScriptAuthUnlock {
                owner,
                input_script_index,
            } => Right((owner.serialize(), *input_script_index)),
        };

        OwnableScriptAuthWitness {
            path,
            signature: DUMMY_SIGNATURE,
        }
    }

    pub fn apply_ownership_transfer(&mut self, new_owner: XOnlyPublicKey) {
        self.program.set_storage_at(0, new_owner.serialize());
        self.parameters.owner_pubkey = new_owner;
    }

    pub fn get_ownable_script_auth_parameters(&self) -> &OwnableScriptAuthParameters {
        &self.parameters
    }
}

impl SimplexProgram for OwnableScriptAuth {
    fn get_program(&self) -> &Program {
        self.program.get_program()
    }

    fn get_network(&self) -> &SimplicityNetwork {
        &self.parameters.network
    }
}
