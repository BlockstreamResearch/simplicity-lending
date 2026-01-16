use std::collections::HashMap;

use simplicityhl::{WitnessValues, str::WitnessName, value::UIntValue};

#[derive(Debug, Clone, Copy)]
pub struct ScriptAuthWitnessParams {
    pub input_script_index: u32,
}

pub fn build_script_auth_witness(params: &ScriptAuthWitnessParams) -> WitnessValues {
    WitnessValues::from(HashMap::from([(
        WitnessName::from_str_unchecked("INPUT_SCRIPT_INDEX"),
        simplicityhl::Value::from(UIntValue::U32(params.input_script_index)),
    )]))
}
