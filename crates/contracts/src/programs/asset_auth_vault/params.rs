use simplex::{provider::SimplicityNetwork, simplicityhl::elements::AssetId};

use crate::artifacts::asset_auth_vault::derived_asset_auth_vault::AssetAuthVaultArguments;

#[derive(Debug, Clone, Copy)]
pub struct ActiveAssetAuthVaultParameters {
    pub vault_asset_id: AssetId,
    pub keeper_asset_id: AssetId,
    pub supplier_asset_id: AssetId,
    pub finalized_vault_cov_hash: [u8; 32],
    pub keeper_min_asset_amount: u64,
    pub with_keeper_asset_burn: bool,
    pub with_supplier_asset_burn: bool,
    pub network: SimplicityNetwork,
}

#[derive(Debug, Clone, Copy)]
pub struct FinalizedAssetAuthVaultParameters {
    pub vault_asset_id: AssetId,
    pub keeper_asset_id: AssetId,
    pub supplier_asset_id: AssetId,
    pub keeper_min_asset_amount: u64,
    pub with_keeper_asset_burn: bool,
    pub with_supplier_asset_burn: bool,
    pub network: SimplicityNetwork,
}

impl From<ActiveAssetAuthVaultParameters> for FinalizedAssetAuthVaultParameters {
    fn from(value: ActiveAssetAuthVaultParameters) -> Self {
        Self {
            vault_asset_id: value.vault_asset_id,
            keeper_asset_id: value.keeper_asset_id,
            supplier_asset_id: value.supplier_asset_id,
            keeper_min_asset_amount: value.keeper_min_asset_amount,
            with_keeper_asset_burn: value.with_keeper_asset_burn,
            with_supplier_asset_burn: value.with_supplier_asset_burn,
            network: value.network,
        }
    }
}

impl ActiveAssetAuthVaultParameters {
    pub fn from_finalized_parameters(
        parameters: &FinalizedAssetAuthVaultParameters,
        finalized_vault_hash: [u8; 32],
    ) -> Self {
        Self {
            vault_asset_id: parameters.vault_asset_id,
            keeper_asset_id: parameters.keeper_asset_id,
            supplier_asset_id: parameters.supplier_asset_id,
            finalized_vault_cov_hash: finalized_vault_hash,
            keeper_min_asset_amount: parameters.keeper_min_asset_amount,
            with_keeper_asset_burn: parameters.with_keeper_asset_burn,
            with_supplier_asset_burn: parameters.with_supplier_asset_burn,
            network: parameters.network,
        }
    }

    pub fn build_arguments(&self) -> AssetAuthVaultArguments {
        AssetAuthVaultArguments {
            vault_asset_id: self.vault_asset_id.into_inner().0,
            keeper_auth_asset_id: self.keeper_asset_id.into_inner().0,
            supplier_auth_asset_id: self.supplier_asset_id.into_inner().0,
            keeper_auth_asset_amount: self.keeper_min_asset_amount,
            finalized_vault_cov_hash: self.finalized_vault_cov_hash,
            is_active: true,
            with_keeper_asset_burn: self.with_keeper_asset_burn,
            with_supplier_asset_burn: self.with_supplier_asset_burn,
        }
    }
}

impl FinalizedAssetAuthVaultParameters {
    pub fn build_arguments(&self) -> AssetAuthVaultArguments {
        AssetAuthVaultArguments {
            vault_asset_id: self.vault_asset_id.into_inner().0,
            keeper_auth_asset_id: self.keeper_asset_id.into_inner().0,
            supplier_auth_asset_id: self.supplier_asset_id.into_inner().0,
            keeper_auth_asset_amount: self.keeper_min_asset_amount,
            finalized_vault_cov_hash: [0u8; 32],
            is_active: false,
            with_keeper_asset_burn: self.with_keeper_asset_burn,
            with_supplier_asset_burn: self.with_supplier_asset_burn,
        }
    }
}
