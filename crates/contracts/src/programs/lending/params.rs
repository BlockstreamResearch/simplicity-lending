use simplex::{provider::SimplicityNetwork, simplicityhl::elements::AssetId};

use crate::{
    artifacts::lending::derived_lending::LendingArguments,
    programs::{
        asset_auth::{AssetAuth, AssetAuthParameters},
        program::SimplexProgram,
    },
    utils::LendingOfferParameters,
};

#[derive(Debug, Clone, Copy)]
pub struct LendingParameters {
    pub collateral_asset_id: AssetId,
    pub principal_asset_id: AssetId,
    pub first_parameters_nft_asset_id: AssetId,
    pub second_parameters_nft_asset_id: AssetId,
    pub borrower_nft_asset_id: AssetId,
    pub lender_nft_asset_id: AssetId,
    pub offer_parameters: LendingOfferParameters,
    pub network: SimplicityNetwork,
}

impl LendingParameters {
    pub fn get_lender_principal_asset_auth(&self) -> AssetAuth {
        AssetAuth::new(AssetAuthParameters {
            asset_id: self.lender_nft_asset_id,
            asset_amount: 1,
            with_asset_burn: true,
            network: self.network,
        })
    }

    pub fn build_arguments(&self) -> LendingArguments {
        let lender_principal_asset_auth = self.get_lender_principal_asset_auth();

        LendingArguments {
            collateral_asset_id: self.collateral_asset_id.into_inner().0,
            principal_asset_id: self.principal_asset_id.into_inner().0,
            first_parameters_nft_asset_id: self.first_parameters_nft_asset_id.into_inner().0,
            second_parameters_nft_asset_id: self.second_parameters_nft_asset_id.into_inner().0,
            borrower_nft_asset_id: self.borrower_nft_asset_id.into_inner().0,
            lender_nft_asset_id: self.lender_nft_asset_id.into_inner().0,
            collateral_amount: self.offer_parameters.collateral_amount,
            principal_amount: self.offer_parameters.principal_amount,
            principal_interest_rate: self.offer_parameters.principal_interest_rate,
            loan_expiration_time: self.offer_parameters.loan_expiration_time,
            lender_principal_cov_hash: lender_principal_asset_auth.get_script_hash(),
        }
    }
}
