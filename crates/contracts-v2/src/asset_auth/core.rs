use simplex::provider::SimplicityNetwork;
use simplex::simplicityhl::elements::{AssetId, Script};
use simplex::transaction::{
    FinalTransaction, PartialInput, PartialOutput, ProgramInput, RequiredSignature, UTXO,
};

use crate::artifacts::asset_auth::AssetAuthProgram;
use crate::artifacts::asset_auth::derived_asset_auth::{AssetAuthArguments, AssetAuthWitness};

use crate::asset_auth::AssetAuthStorage;

pub struct AssetAuth {
    program: AssetAuthProgram,
    storage: AssetAuthStorage,
    network: SimplicityNetwork,
}

impl AssetAuth {
    #[must_use]
    pub fn new(storage: AssetAuthStorage, network: SimplicityNetwork) -> Self {
        let mut program =
            AssetAuthProgram::new(&AssetAuthArguments::default()).with_storage_capacity(1);

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
    pub fn get_storage(&self) -> AssetAuthStorage {
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
        let program_witness: AssetAuthWitness = AssetAuthWitness {
            auth_input_index,
            auth_asset_id: self.storage.auth_asset_id.into_inner().0,
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
