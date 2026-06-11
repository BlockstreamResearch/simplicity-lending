use simplex::{provider::SimplicityNetwork, simplicityhl::elements::AssetId};

use crate::{
    artifacts::lending::derived_lending::LendingArguments,
    programs::{
        asset_auth::{AssetAuth, AssetAuthParameters},
        asset_auth_vault::{
            ActiveAssetAuthVault, FinalizedAssetAuthVault, FinalizedAssetAuthVaultParameters,
        },
        lending::OfferParameters,
        program::SimplexProgram,
    },
};

#[derive(Debug, Clone, Copy)]
pub struct LendingOfferParameters {
    pub collateral_asset_id: AssetId,
    pub principal_asset_id: AssetId,
    pub borrower_nft_asset_id: AssetId,
    pub lender_nft_asset_id: AssetId,
    pub protocol_fee_keeper_asset_id: AssetId,
    pub offer_parameters: OfferParameters,
    pub network: SimplicityNetwork,
}

impl LendingOfferParameters {
    pub fn get_principal_output_asset_auth(&self) -> AssetAuth {
        AssetAuth::new(AssetAuthParameters {
            asset_id: self.borrower_nft_asset_id,
            asset_amount: 1,
            with_asset_burn: false,
            network: self.network,
        })
    }

    pub fn get_active_lender_vault(&self) -> ActiveAssetAuthVault {
        ActiveAssetAuthVault::from_finalized_vault(self.get_lender_vault_finalized_parameters())
    }

    pub fn get_active_protocol_fee_vault(&self) -> ActiveAssetAuthVault {
        ActiveAssetAuthVault::from_finalized_vault(
            self.get_protocol_fee_vault_finalized_parameters(),
        )
    }

    pub fn get_finalized_lender_vault(&self) -> FinalizedAssetAuthVault {
        FinalizedAssetAuthVault::new(self.get_lender_vault_finalized_parameters())
    }

    pub fn get_finalized_protocol_fee_vault(&self) -> FinalizedAssetAuthVault {
        FinalizedAssetAuthVault::new(self.get_protocol_fee_vault_finalized_parameters())
    }

    pub fn build_arguments(&self) -> LendingArguments {
        LendingArguments {
            collateral_asset_id: self.collateral_asset_id.into_inner().0,
            principal_asset_id: self.principal_asset_id.into_inner().0,
            borrower_nft_asset_id: self.borrower_nft_asset_id.into_inner().0,
            lender_nft_asset_id: self.lender_nft_asset_id.into_inner().0,
            collateral_amount: self.offer_parameters.collateral_amount,
            principal_amount: self.offer_parameters.principal_amount,
            principal_interest_rate: self.offer_parameters.principal_interest_rate as u64,
            loan_expiration_time: self.offer_parameters.loan_expiration_time,
            lender_vault_cov_hash: self.get_active_lender_vault().get_script_hash(),
            finalized_lender_vault_cov_hash: self.get_finalized_lender_vault().get_script_hash(),
            protocol_fee_vault_cov_hash: self.get_active_protocol_fee_vault().get_script_hash(),
            finalized_protocol_fee_vault_cov_hash: self
                .get_finalized_protocol_fee_vault()
                .get_script_hash(),
            principal_output_script_hash: self.get_principal_output_asset_auth().get_script_hash(),
        }
    }

    fn get_lender_vault_finalized_parameters(&self) -> FinalizedAssetAuthVaultParameters {
        FinalizedAssetAuthVaultParameters {
            vault_asset_id: self.principal_asset_id,
            keeper_asset_id: self.lender_nft_asset_id,
            keeper_min_asset_amount: 1,
            with_keeper_asset_burn: true,
            supplier_asset_id: self.borrower_nft_asset_id,
            with_supplier_asset_burn: true,
            network: self.network,
        }
    }

    fn get_protocol_fee_vault_finalized_parameters(&self) -> FinalizedAssetAuthVaultParameters {
        FinalizedAssetAuthVaultParameters {
            vault_asset_id: self.principal_asset_id,
            keeper_asset_id: self.protocol_fee_keeper_asset_id,
            keeper_min_asset_amount: 1,
            with_keeper_asset_burn: false,
            supplier_asset_id: self.borrower_nft_asset_id,
            with_supplier_asset_burn: true,
            network: self.network,
        }
    }
}
