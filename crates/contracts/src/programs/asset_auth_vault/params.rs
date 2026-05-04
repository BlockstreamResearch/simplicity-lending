use simplex::{provider::SimplicityNetwork, simplicityhl::elements::AssetId};

use crate::artifacts::asset_auth_vault::derived_asset_auth_vault::AssetAuthVaultArguments;

#[derive(Debug, Clone, Copy)]
pub struct AssetAuthVaultParameters {
    pub vault_asset_id: AssetId,
    pub keeper_asset_id: AssetId,
    pub supplier_asset_id: AssetId,
    pub keeper_min_asset_amount: u64,
    pub with_keeper_asset_burn: bool,
    pub with_supplier_asset_burn: bool,
    pub network: SimplicityNetwork,
    finalized_vault_cov_hash: [u8; 32],
}

impl AssetAuthVaultParameters {
    pub fn new(
        vault_asset_id: AssetId,
        keeper_asset_id: AssetId,
        supplier_asset_id: AssetId,
        keeper_min_asset_amount: u64,
        with_keeper_asset_burn: bool,
        with_supplier_asset_burn: bool,
        network: SimplicityNetwork,
    ) -> Self {
        Self {
            vault_asset_id,
            keeper_asset_id,
            supplier_asset_id,
            keeper_min_asset_amount,
            with_keeper_asset_burn,
            with_supplier_asset_burn,
            network,
            finalized_vault_cov_hash: [0u8; 32],
        }
    }

    pub fn from_finalized_parameters(self, finalized_vault_cov_hash: [u8; 32]) -> Self {
        Self {
            vault_asset_id: self.vault_asset_id,
            keeper_asset_id: self.keeper_asset_id,
            supplier_asset_id: self.supplier_asset_id,
            keeper_min_asset_amount: self.keeper_min_asset_amount,
            with_keeper_asset_burn: self.with_keeper_asset_burn,
            with_supplier_asset_burn: self.with_supplier_asset_burn,
            network: self.network,
            finalized_vault_cov_hash,
        }
    }

    pub fn to_finalized_parameters(self) -> Self {
        Self::new(
            self.vault_asset_id,
            self.keeper_asset_id,
            self.supplier_asset_id,
            self.keeper_min_asset_amount,
            self.with_keeper_asset_burn,
            self.with_supplier_asset_burn,
            self.network,
        )
    }

    pub fn build_arguments(&self) -> AssetAuthVaultArguments {
        AssetAuthVaultArguments {
            vault_asset_id: self.vault_asset_id.into_inner().0,
            keeper_auth_asset_id: self.keeper_asset_id.into_inner().0,
            supplier_auth_asset_id: self.supplier_asset_id.into_inner().0,
            keeper_auth_asset_amount: self.keeper_min_asset_amount,
            finalized_vault_cov_hash: self.finalized_vault_cov_hash,
            is_finalized: self.is_finalized(),
            with_keeper_asset_burn: self.with_keeper_asset_burn,
            with_supplier_asset_burn: self.with_supplier_asset_burn,
        }
    }

    pub fn get_finalized_vault_hash(&self) -> [u8; 32] {
        self.finalized_vault_cov_hash
    }

    pub fn is_finalized(&self) -> bool {
        self.finalized_vault_cov_hash == [0u8; 32]
    }
}
