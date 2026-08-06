use simplex::{provider::SimplicityNetwork, simplicityhl::elements::AssetId};

use crate::artifacts::asset_auth_vault::derived_asset_auth_vault::AssetAuthVaultArguments;

#[derive(Debug, Clone, Copy)]
pub struct AssetAuthVaultParameters {
    pub vault_asset_id: AssetId,
    pub keeper_asset_id: AssetId,
    pub supplier_asset_id: AssetId,
    pub supply_goal: u64,
    pub with_keeper_asset_burn: bool,
    pub with_supplier_asset_burn: bool,
    pub network: SimplicityNetwork,
}

impl AssetAuthVaultParameters {
    pub fn build_arguments(&self) -> AssetAuthVaultArguments {
        AssetAuthVaultArguments {
            vault_asset_id: self.vault_asset_id.into_inner().0,
            keeper_auth_asset_id: self.keeper_asset_id.into_inner().0,
            supplier_auth_asset_id: self.supplier_asset_id.into_inner().0,
            supply_goal: self.supply_goal,
            with_keeper_asset_burn: self.with_keeper_asset_burn,
            with_supplier_asset_burn: self.with_supplier_asset_burn,
        }
    }
}
