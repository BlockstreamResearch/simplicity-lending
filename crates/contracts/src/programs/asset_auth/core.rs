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

#[derive(Debug, Clone)]
pub enum AssetAuthSchema {
    Create {
        asset_id_to_lock: AssetId,
        amount_to_lock: u64,
    },
    Unlock {
        program_utxo: UTXO,
        witness_params: AssetAuthWitnessParams,
    },
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

    pub fn use_schema(&self, ft: &mut FinalTransaction, schema: AssetAuthSchema) {
        match schema {
            AssetAuthSchema::Create {
                asset_id_to_lock,
                amount_to_lock,
            } => self.use_creation_schema(ft, asset_id_to_lock, amount_to_lock),
            AssetAuthSchema::Unlock {
                program_utxo,
                witness_params,
            } => self.use_unlocking_schema(ft, program_utxo, witness_params),
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

    fn use_unlocking_schema(
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
        self.program.get_program()
    }

    fn get_network(&self) -> &SimplicityNetwork {
        &self.parameters.network
    }
}
