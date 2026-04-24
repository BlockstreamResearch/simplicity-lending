use simplex::{
    constants::DUMMY_SIGNATURE,
    either::Either::{Left, Right},
    simplicityhl::elements::schnorr::XOnlyPublicKey,
};

use crate::artifacts::ownable_script_auth::derived_ownable_script_auth::OwnableScriptAuthWitness;

#[derive(Debug, Clone, Copy)]
pub enum OwnableScriptAuthWitnessBranch {
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

impl OwnableScriptAuthWitnessBranch {
    pub fn build_witness(&self) -> Box<OwnableScriptAuthWitness> {
        let path = match self {
            OwnableScriptAuthWitnessBranch::OwnershipTransfer {
                current_owner,
                new_owner,
                program_output_index,
            } => Left((
                current_owner.serialize(),
                new_owner.serialize(),
                DUMMY_SIGNATURE,
                *program_output_index,
            )),
            OwnableScriptAuthWitnessBranch::ScriptAuthUnlock {
                owner,
                input_script_index,
            } => Right((owner.serialize(), DUMMY_SIGNATURE, *input_script_index)),
        };

        Box::new(OwnableScriptAuthWitness { path })
    }
}
