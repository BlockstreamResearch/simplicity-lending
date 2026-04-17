use crate::artifacts::asset_auth::derived_asset_auth::AssetAuthWitness;

#[derive(Debug, Clone, Copy)]
pub struct AssetAuthWitnessParams {
    pub input_asset_index: u32,
    pub output_asset_index: u32,
}

impl AssetAuthWitnessParams {
    pub fn new(input_asset_index: u32, output_asset_index: u32) -> Self {
        Self {
            input_asset_index,
            output_asset_index,
        }
    }

    pub fn build_witness(&self) -> Box<AssetAuthWitness> {
        Box::new(AssetAuthWitness {
            input_asset_index: self.input_asset_index,
            output_asset_index: self.output_asset_index,
        })
    }
}
