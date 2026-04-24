use crate::artifacts::script_auth::derived_script_auth::ScriptAuthWitness;

#[derive(Debug, Clone, Copy)]
pub struct ScriptAuthWitnessParams {
    input_script_index: u32,
}

impl ScriptAuthWitnessParams {
    pub fn new(input_script_index: u32) -> Self {
        Self { input_script_index }
    }

    pub fn build_witness(&self) -> Box<ScriptAuthWitness> {
        Box::new(ScriptAuthWitness {
            input_script_index: self.input_script_index,
        })
    }
}
