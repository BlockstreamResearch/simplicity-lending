use simplex::either::Either::{Left, Right};
use simplex::program::Program;
use simplex::simplicityhl::elements::{AssetId, secp256k1_zkp::XOnlyPublicKey};
use simplex::{provider::SimplicityNetwork, utils::tr_unspendable_key};

use crate::artifacts::lending::LendingProgram;
use crate::artifacts::lending::derived_lending::{LendingArguments, LendingWitness};
use crate::programs::program::SimplexProgram;
use crate::programs::{AssetAuth, AssetAuthParameters};
use crate::utils::LendingOfferParameters;

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

impl From<LendingParameters> for LendingArguments {
    fn from(value: LendingParameters) -> Self {
        let lender_principal_asset_auth = value.get_lender_principal_asset_auth();

        Self {
            collateral_asset_id: value.collateral_asset_id.into_inner().0,
            principal_asset_id: value.principal_asset_id.into_inner().0,
            first_parameters_nft_asset_id: value.first_parameters_nft_asset_id.into_inner().0,
            second_parameters_nft_asset_id: value.second_parameters_nft_asset_id.into_inner().0,
            borrower_nft_asset_id: value.borrower_nft_asset_id.into_inner().0,
            lender_nft_asset_id: value.lender_nft_asset_id.into_inner().0,
            collateral_amount: value.offer_parameters.collateral_amount,
            principal_amount: value.offer_parameters.principal_amount,
            principal_interest_rate: value.offer_parameters.principal_interest_rate,
            loan_expiration_time: value.offer_parameters.loan_expiration_time,
            lender_principal_cov_hash: lender_principal_asset_auth.get_script_hash(),
        }
    }
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
}

pub struct Lending {
    program: LendingProgram,
    parameters: LendingParameters,
}

#[derive(Debug, Clone, Copy)]
pub enum LendingBranch {
    LoanRepayment,
    LoanLiquidation,
}

impl Lending {
    pub fn new(parameters: LendingParameters) -> Self {
        Self::from_internal_key(tr_unspendable_key(), parameters)
    }

    pub fn from_internal_key(internal_key: XOnlyPublicKey, parameters: LendingParameters) -> Self {
        let arguments = LendingArguments::from(parameters);

        Self {
            program: LendingProgram::new(internal_key, arguments),
            parameters,
        }
    }

    pub fn get_lending_witness(witness_branch: &LendingBranch) -> LendingWitness {
        let path = match witness_branch {
            LendingBranch::LoanRepayment => Left(()),
            LendingBranch::LoanLiquidation => Right(()),
        };

        LendingWitness { path }
    }

    pub fn get_lending_parameters(&self) -> &LendingParameters {
        &self.parameters
    }
}

impl SimplexProgram for Lending {
    fn get_program(&self) -> &Program {
        self.program.get_program()
    }

    fn get_network(&self) -> &SimplicityNetwork {
        &self.parameters.network
    }
}
