use simplex::program::Program;
use simplex::simplicityhl::elements::secp256k1_zkp::XOnlyPublicKey;
use simplex::{provider::SimplicityNetwork, utils::tr_unspendable_key};

use crate::artifacts::asset_auth::AssetAuthProgram;
use crate::artifacts::asset_auth::derived_asset_auth::{AssetAuthArguments, AssetAuthWitness};
use crate::programs::program::SimplexProgram;

pub struct AssetAuth {
    arguments: AssetAuthArguments,
    program: AssetAuthProgram,
    network: SimplicityNetwork,
}

pub struct AssetAuthWitnessParams {
    pub input_asset_index: u32,
    pub output_asset_index: u32,
}

impl AssetAuth {
    pub fn new(arguments: AssetAuthArguments, network: SimplicityNetwork) -> AssetAuth {
        Self::from_internal_key(tr_unspendable_key(), arguments, network)
    }

    pub fn from_internal_key(
        internal_key: XOnlyPublicKey,
        arguments: AssetAuthArguments,
        network: SimplicityNetwork,
    ) -> AssetAuth {
        AssetAuth {
            arguments: arguments.clone(),
            program: AssetAuthProgram::new(internal_key, arguments),
            network,
        }
    }

    pub fn get_asset_auth_witness(witness_params: &AssetAuthWitnessParams) -> AssetAuthWitness {
        AssetAuthWitness {
            input_asset_index: witness_params.input_asset_index,
            output_asset_index: witness_params.output_asset_index,
        }
    }

    pub fn get_asset_auth_arguments(&self) -> &AssetAuthArguments {
        &self.arguments
    }
}

impl SimplexProgram for AssetAuth {
    fn get_program(&self) -> &Program {
        self.program.get_program()
    }

    fn get_network(&self) -> &SimplicityNetwork {
        &self.network
    }
}
