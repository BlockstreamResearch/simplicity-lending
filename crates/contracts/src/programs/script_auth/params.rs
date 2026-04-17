use simplex::provider::SimplicityNetwork;

use crate::artifacts::script_auth::derived_script_auth::ScriptAuthArguments;

#[derive(Debug, Clone, Copy)]
pub struct ScriptAuthParameters {
    pub script_hash: [u8; 32],
    pub network: SimplicityNetwork,
}

impl ScriptAuthParameters {
    pub fn build_arguments(&self) -> ScriptAuthArguments {
        ScriptAuthArguments {
            script_hash: self.script_hash,
        }
    }
}
