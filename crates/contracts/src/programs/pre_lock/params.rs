use simplex::{
    provider::SimplicityNetwork,
    simplicityhl::elements::{AssetId, schnorr::XOnlyPublicKey},
};

use crate::{
    artifacts::pre_lock::derived_pre_lock::PreLockArguments,
    programs::{Lending, LendingParameters, program::SimplexProgram, script_auth::ScriptAuth},
    utils::LendingOfferParameters,
};

#[derive(Debug, Clone, Copy)]
pub struct PreLockParameters {
    pub collateral_asset_id: AssetId,
    pub principal_asset_id: AssetId,
    pub first_parameters_nft_asset_id: AssetId,
    pub second_parameters_nft_asset_id: AssetId,
    pub borrower_nft_asset_id: AssetId,
    pub lender_nft_asset_id: AssetId,
    pub offer_parameters: LendingOfferParameters,
    pub borrower_pubkey: XOnlyPublicKey,
    pub borrower_output_script_hash: [u8; 32],
    pub network: SimplicityNetwork,
}

impl From<PreLockParameters> for LendingParameters {
    fn from(value: PreLockParameters) -> Self {
        LendingParameters::from(&value)
    }
}

impl From<&PreLockParameters> for LendingParameters {
    fn from(value: &PreLockParameters) -> Self {
        Self {
            collateral_asset_id: value.collateral_asset_id,
            principal_asset_id: value.principal_asset_id,
            first_parameters_nft_asset_id: value.first_parameters_nft_asset_id,
            second_parameters_nft_asset_id: value.second_parameters_nft_asset_id,
            borrower_nft_asset_id: value.borrower_nft_asset_id,
            lender_nft_asset_id: value.lender_nft_asset_id,
            offer_parameters: value.offer_parameters,
            network: value.network,
        }
    }
}

impl PreLockParameters {
    pub fn get_parameter_nfts_script_auth(&self) -> ScriptAuth {
        let lending = Lending::new(self.into());

        ScriptAuth::from_simplex_program(&lending)
    }

    pub fn build_arguments(&self) -> PreLockArguments {
        let parameter_nfts_script_auth = self.get_parameter_nfts_script_auth();

        PreLockArguments {
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
            borrower_pub_key: self.borrower_pubkey.serialize(),
            lending_cov_hash: parameter_nfts_script_auth.get_parameters().script_hash,
            parameters_nft_output_script_hash: parameter_nfts_script_auth.get_script_hash(),
            borrower_nft_output_script_hash: self.borrower_output_script_hash,
            principal_output_script_hash: self.borrower_output_script_hash,
        }
    }
}
