use simplex::{provider::SimplicityNetwork, simplicityhl::elements::secp256k1_zkp::XOnlyPublicKey};

use crate::artifacts::fee_collector::derived_fee_collector::FeeCollectorArguments;

#[derive(Debug, Clone, Copy)]
pub struct FeeCollectorParameters {
    pub withdrawal_pubkey: XOnlyPublicKey,
    pub network: SimplicityNetwork,
}

impl FeeCollectorParameters {
    pub fn build_arguments(&self) -> FeeCollectorArguments {
        FeeCollectorArguments {
            withdrawal_pubkey: self.withdrawal_pubkey.serialize(),
        }
    }
}
