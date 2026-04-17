use simplex::{provider::SimplicityNetwork, simplicityhl::elements::schnorr::XOnlyPublicKey};

use crate::artifacts::ownable_script_auth::derived_ownable_script_auth::OwnableScriptAuthArguments;

#[derive(Debug, Clone, Copy)]
pub struct OwnableScriptAuthParameters {
    pub script_hash: [u8; 32],
    pub owner_pubkey: XOnlyPublicKey,
    pub network: SimplicityNetwork,
}

impl OwnableScriptAuthParameters {
    pub fn build_arguments(&self) -> OwnableScriptAuthArguments {
        OwnableScriptAuthArguments {
            script_hash: self.script_hash,
        }
    }
}
