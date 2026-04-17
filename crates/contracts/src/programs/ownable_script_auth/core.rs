use simplex::program::Program;
use simplex::provider::SimplicityNetwork;
use simplex::simplicityhl::elements::secp256k1_zkp::XOnlyPublicKey;
use simplex::simplicityhl::elements::{AssetId, Script};
use simplex::transaction::{FinalTransaction, PartialOutput, UTXO};

use crate::artifacts::ownable_script_auth::OwnableScriptAuthProgram;

use crate::programs::program::SimplexProgram;
use crate::programs::{OwnableScriptAuthParameters, OwnableScriptAuthWitnessBranch};

pub struct OwnableScriptAuth {
    program: OwnableScriptAuthProgram,
    parameters: OwnableScriptAuthParameters,
}

#[derive(Debug, Clone)]
pub enum OwnableScriptAuthSchema {
    Create {
        asset_id_to_lock: AssetId,
        amount_to_lock: u64,
    },
    OwnershipTransfer {
        program_utxo: UTXO,
        new_owner: XOnlyPublicKey,
    },
    Unlock {
        program_utxo: UTXO,
        auth_input_index: u32,
    },
}

impl OwnableScriptAuth {
    pub fn new(parameters: OwnableScriptAuthParameters) -> Self {
        let mut program =
            OwnableScriptAuthProgram::new(parameters.build_arguments()).with_storage_capacity(1);

        program.set_storage_at(0, parameters.owner_pubkey.serialize());

        Self {
            program,
            parameters,
        }
    }

    pub fn get_parameters(&self) -> &OwnableScriptAuthParameters {
        &self.parameters
    }

    pub fn use_schema(&mut self, ft: &mut FinalTransaction, schema: OwnableScriptAuthSchema) {
        match schema {
            OwnableScriptAuthSchema::Create {
                asset_id_to_lock,
                amount_to_lock,
            } => self.use_creation_schema(ft, asset_id_to_lock, amount_to_lock),
            OwnableScriptAuthSchema::OwnershipTransfer {
                program_utxo,
                new_owner,
            } => self.use_ownership_transfer_schema(ft, program_utxo, new_owner),
            OwnableScriptAuthSchema::Unlock {
                program_utxo,
                auth_input_index,
            } => self.use_unlock_schema(ft, program_utxo, auth_input_index),
        }
    }

    fn use_creation_schema(
        &self,
        ft: &mut FinalTransaction,
        asset_id_to_lock: AssetId,
        amount_to_lock: u64,
    ) {
        self.add_program_output(ft, asset_id_to_lock, amount_to_lock);
    }

    fn use_ownership_transfer_schema(
        &mut self,
        ft: &mut FinalTransaction,
        program_utxo: UTXO,
        new_owner: XOnlyPublicKey,
    ) {
        let outputs_count = ft.n_outputs() as u32;

        let witness_branch = OwnableScriptAuthWitnessBranch::OwnershipTransfer {
            current_owner: self.parameters.owner_pubkey,
            new_owner,
            program_output_index: outputs_count,
        };

        let locked_asset = program_utxo.explicit_asset();
        let locked_amount = program_utxo.explicit_amount();

        self.add_program_input_with_signature(
            ft,
            program_utxo,
            witness_branch.build_witness(),
            "SIGNATURE".into(),
        );

        self.apply_ownership_transfer(new_owner);

        self.add_program_output(ft, locked_asset, locked_amount);

        ft.add_output(PartialOutput::new(
            Script::new_op_return(new_owner.serialize().as_slice()),
            0,
            AssetId::default(),
        ));
    }

    fn use_unlock_schema(
        &self,
        ft: &mut FinalTransaction,
        program_utxo: UTXO,
        auth_input_index: u32,
    ) {
        let witness_branch = OwnableScriptAuthWitnessBranch::ScriptAuthUnlock {
            owner: self.parameters.owner_pubkey,
            input_script_index: auth_input_index,
        };

        self.add_program_input_with_signature(
            ft,
            program_utxo.clone(),
            witness_branch.build_witness(),
            "SIGNATURE".into(),
        );
    }

    fn apply_ownership_transfer(&mut self, new_owner: XOnlyPublicKey) {
        self.program.set_storage_at(0, new_owner.serialize());
        self.parameters.owner_pubkey = new_owner;
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
