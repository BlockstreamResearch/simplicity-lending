use simplex::provider::SimplicityNetwork;
use simplex::simplicityhl::elements::{AssetId, Script};
use simplex::transaction::{
    FinalTransaction, PartialInput, PartialOutput, ProgramInput, RequiredSignature, UTXO,
};

use crate::artifacts::script_auth::ScriptAuthProgram;
use crate::artifacts::script_auth::derived_script_auth::{ScriptAuthArguments, ScriptAuthWitness};

use crate::script_auth::ScriptAuthStorage;

pub struct ScriptAuth {
    program: ScriptAuthProgram,
    storage: ScriptAuthStorage,
    network: SimplicityNetwork,
}

impl ScriptAuth {
    #[must_use]
    pub fn new(storage: ScriptAuthStorage, network: SimplicityNetwork) -> Self {
        let mut program =
            ScriptAuthProgram::new(&ScriptAuthArguments::default()).with_storage_capacity(1);

        storage.apply(&mut program);

        Self {
            program,
            storage,
            network,
        }
    }

    #[must_use]
    pub fn get_script_pubkey(&self) -> Script {
        self.program.get_script_pubkey(&self.network)
    }

    #[must_use]
    pub fn get_network(&self) -> &SimplicityNetwork {
        &self.network
    }

    #[must_use]
    pub fn get_storage(&self) -> ScriptAuthStorage {
        self.storage
    }

    pub fn attach_creation(&self, ft: &mut FinalTransaction, amount: u64, asset_id: AssetId) {
        ft.add_output(PartialOutput::new(
            self.get_script_pubkey(),
            amount,
            asset_id,
        ));
    }

    pub fn attach_unlocking(
        &self,
        ft: &mut FinalTransaction,
        program_utxo: UTXO,
        auth_input_index: u32,
    ) {
        let program_witness: ScriptAuthWitness = ScriptAuthWitness {
            auth_input_index,
            auth_script_hash: self.storage.auth_script_hash,
        };

        ft.add_program_input(
            PartialInput::new(program_utxo),
            ProgramInput::new(
                Box::new(self.program.as_ref().clone()),
                Box::new(program_witness),
            ),
            RequiredSignature::None,
        );
    }
}
