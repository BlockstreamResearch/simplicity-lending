use simplex::{provider::SimplicityNetwork, simplicityhl::elements::AssetId};

use crate::{
    artifacts::lending::derived_lending::LendingArguments,
    programs::{
        asset_auth_vault::{
            ActiveAssetAuthVault, FinalizedAssetAuthVault, FinalizedAssetAuthVaultParameters,
        },
        program::SimplexProgram,
    },
    utils::LendingOfferParameters,
};

#[derive(Debug, Clone, Copy)]
pub struct LendingParameters {
    pub collateral_asset_id: AssetId,
    pub principal_asset_id: AssetId,
    pub borrower_debt_nft_asset_id: AssetId,
    pub lender_nft_asset_id: AssetId,
    pub protocol_fee_keeper_asset_id: AssetId,
    pub offer_parameters: LendingOfferParameters,
    pub network: SimplicityNetwork,
}

impl LendingParameters {
    pub fn get_lender_vault_finalized_parameters(&self) -> FinalizedAssetAuthVaultParameters {
        FinalizedAssetAuthVaultParameters {
            vault_asset_id: self.principal_asset_id,
            keeper_asset_id: self.lender_nft_asset_id,
            keeper_min_asset_amount: 1,
            with_keeper_asset_burn: true,
            supplier_asset_id: self.borrower_debt_nft_asset_id,
            with_supplier_asset_burn: true,
            network: self.network,
        }
    }

    pub fn get_protocol_fee_vault_finalized_parameters(&self) -> FinalizedAssetAuthVaultParameters {
        FinalizedAssetAuthVaultParameters {
            vault_asset_id: self.principal_asset_id,
            keeper_asset_id: self.protocol_fee_keeper_asset_id,
            keeper_min_asset_amount: 1,
            with_keeper_asset_burn: false,
            supplier_asset_id: self.borrower_debt_nft_asset_id,
            with_supplier_asset_burn: true,
            network: self.network,
        }
    }

    pub fn build_arguments(&self) -> LendingArguments {
        let (active_lender_vault_hash, finalized_lender_vault_hash) =
            Self::get_vault_script_hashes(self.get_lender_vault_finalized_parameters());
        let (active_protocol_fee_vault_hash, finalized_protocol_fee_vault_hash) =
            Self::get_vault_script_hashes(self.get_protocol_fee_vault_finalized_parameters());

        LendingArguments {
            collateral_asset_id: self.collateral_asset_id.into_inner().0,
            principal_asset_id: self.principal_asset_id.into_inner().0,
            borrower_debt_nft_asset_id: self.borrower_debt_nft_asset_id.into_inner().0,
            lender_nft_asset_id: self.lender_nft_asset_id.into_inner().0,
            collateral_amount: self.offer_parameters.collateral_amount,
            principal_amount: self.offer_parameters.principal_amount,
            principal_interest_rate: self.offer_parameters.principal_interest_rate as u64,
            loan_expiration_time: self.offer_parameters.loan_expiration_time,
            lender_vault_cov_hash: active_lender_vault_hash,
            finalized_lender_vault_cov_hash: finalized_lender_vault_hash,
            protocol_fee_vault_cov_hash: active_protocol_fee_vault_hash,
            finalized_protocol_fee_vault_cov_hash: finalized_protocol_fee_vault_hash,
        }
    }

    fn get_vault_script_hashes(
        vault_parameters: FinalizedAssetAuthVaultParameters,
    ) -> ([u8; 32], [u8; 32]) {
        let active_vault = ActiveAssetAuthVault::from_finalized_vault(vault_parameters);
        let finalized_vault = FinalizedAssetAuthVault::new(vault_parameters);

        (
            active_vault.get_script_hash(),
            finalized_vault.get_script_hash(),
        )
    }
}
