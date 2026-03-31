use simplex::program::Program;
use simplex::simplicityhl::elements::{AssetId, secp256k1_zkp::XOnlyPublicKey};
use simplex::{provider::SimplicityNetwork, utils::tr_unspendable_key};

use crate::artifacts::asset_auth::AssetAuthProgram;
use crate::artifacts::asset_auth::derived_asset_auth::{AssetAuthArguments, AssetAuthWitness};
use crate::programs::program::SimplexProgram;

#[derive(Debug, Clone, Copy)]
pub struct AssetAuthParameters {
    pub asset_id: AssetId,
    pub asset_amount: u64,
    pub with_asset_burn: bool,
    pub network: SimplicityNetwork,
}

impl From<AssetAuthParameters> for AssetAuthArguments {
    fn from(value: AssetAuthParameters) -> Self {
        Self {
            with_asset_burn: value.with_asset_burn,
            asset_amount: value.asset_amount,
            asset_id: value.asset_id.into_inner().0,
        }
    }
}

pub struct AssetAuth {
    program: AssetAuthProgram,
    parameters: AssetAuthParameters,
}

pub struct AssetAuthWitnessParams {
    pub input_asset_index: u32,
    pub output_asset_index: u32,
}

impl AssetAuth {
    pub fn new(parameters: AssetAuthParameters) -> AssetAuth {
        Self::from_internal_key(tr_unspendable_key(), parameters)
    }

    pub fn from_internal_key(
        internal_key: XOnlyPublicKey,
        parameters: AssetAuthParameters,
    ) -> AssetAuth {
        AssetAuth {
            program: AssetAuthProgram::new(internal_key, AssetAuthArguments::from(parameters)),
            parameters,
        }
    }

    pub fn get_asset_auth_witness(witness_params: &AssetAuthWitnessParams) -> AssetAuthWitness {
        AssetAuthWitness {
            input_asset_index: witness_params.input_asset_index,
            output_asset_index: witness_params.output_asset_index,
        }
    }

    pub fn get_asset_auth_parameters(&self) -> &AssetAuthParameters {
        &self.parameters
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
