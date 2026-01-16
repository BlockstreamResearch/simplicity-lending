use std::collections::HashMap;

use simplicityhl::{WitnessValues, str::WitnessName, value::UIntValue};

#[derive(Debug, Clone, Copy)]
pub struct AssetAuthWitnessParams {
    pub input_asset_index: u32,
    pub output_asset_index: u32,
}

pub fn build_asset_auth_witness(params: &AssetAuthWitnessParams) -> WitnessValues {
    WitnessValues::from(HashMap::from([
        (
            WitnessName::from_str_unchecked("INPUT_ASSET_INDEX"),
            simplicityhl::Value::from(UIntValue::U32(params.input_asset_index)),
        ),
        (
            WitnessName::from_str_unchecked("OUTPUT_ASSET_INDEX"),
            simplicityhl::Value::from(UIntValue::U32(params.output_asset_index)),
        ),
    ]))
}
