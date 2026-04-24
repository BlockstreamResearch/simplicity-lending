use simplex::{provider::SimplicityNetwork, simplicityhl::elements::AssetId};

use crate::artifacts::asset_auth::derived_asset_auth::AssetAuthArguments;

#[derive(Debug, Clone, Copy)]
pub struct AssetAuthParameters {
    pub asset_id: AssetId,
    pub asset_amount: u64,
    pub with_asset_burn: bool,
    pub network: SimplicityNetwork,
}

impl AssetAuthParameters {
    pub fn build_arguments(&self) -> AssetAuthArguments {
        AssetAuthArguments {
            with_asset_burn: self.with_asset_burn,
            asset_amount: self.asset_amount,
            asset_id: self.asset_id.into_inner().0,
        }
    }
}
