use simplex::constants::DUMMY_SIGNATURE;
use simplex::either::Either::{Left, Right};
use simplex::program::Program;
use simplex::simplicityhl::elements::secp256k1_zkp::XOnlyPublicKey;
use simplex::simplicityhl::elements::{
    AssetId, Script, WPubkeyHash,
    hashes::{Hash, HashEngine},
};
use simplex::utils::hash_script;
use simplex::{provider::SimplicityNetwork, utils::tr_unspendable_key};

use crate::artifacts::pre_lock::PreLockProgram;
use crate::artifacts::pre_lock::derived_pre_lock::{PreLockArguments, PreLockWitness};
use crate::programs::program::{SimplexProgram, SimplexProgramError};
use crate::programs::{Lending, LendingParameters, ScriptAuth};
use crate::utils::LendingOfferParameters;

#[derive(Debug, Clone, Copy)]
pub struct PreLockParameters {
    pub collateral_asset_id: AssetId,
    pub principal_asset_id: AssetId,
    pub first_parameters_nft_asset_id: AssetId,
    pub second_parameters_nft_asset_id: AssetId,
    pub borrower_nft_asset_id: AssetId,
    pub lender_nft_asset_id: AssetId,
    pub offer_parameters: LendingOfferParameters,
    pub borrower_pubkey: [u8; 32],
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

impl TryFrom<PreLockParameters> for PreLockArguments {
    type Error = SimplexProgramError;

    fn try_from(value: PreLockParameters) -> Result<Self, Self::Error> {
        let parameter_nfts_script_auth = value.get_parameter_nfts_script_auth()?;

        let borrower_wpkh_script = value.get_borrower_wpkh_script_pubkey();
        let borrower_output_script_hash = hash_script(&borrower_wpkh_script);

        Ok(Self {
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
            borrower_pub_key: value.borrower_pubkey,
            lending_cov_hash: parameter_nfts_script_auth
                .get_script_auth_parameters()
                .script_hash,
            parameters_nft_output_script_hash: parameter_nfts_script_auth.get_script_hash()?,
            borrower_nft_output_script_hash: borrower_output_script_hash,
            principal_output_script_hash: borrower_output_script_hash,
        })
    }
}

impl PreLockParameters {
    pub fn get_borrower_wpkh_script_pubkey(&self) -> Script {
        let mut engine = WPubkeyHash::engine();
        engine.input(self.borrower_pubkey.as_slice());

        let wpkh = WPubkeyHash::from_engine(engine);
        Script::new_v0_wpkh(&wpkh)
    }

    pub fn get_parameter_nfts_script_auth(&self) -> Result<ScriptAuth, SimplexProgramError> {
        let lending = Lending::new(self.into())?;

        ScriptAuth::from_simplex_program(&lending)
    }
}

pub struct PreLock {
    program: PreLockProgram,
    parameters: PreLockParameters,
}

#[derive(Debug, Clone, Copy)]
pub enum PreLockBranch {
    LendingCreation,
    PreLockCancellation,
}

impl PreLock {
    pub fn new(parameters: PreLockParameters) -> Result<PreLock, SimplexProgramError> {
        Self::from_internal_key(tr_unspendable_key(), parameters)
    }

    pub fn from_internal_key(
        internal_key: XOnlyPublicKey,
        parameters: PreLockParameters,
    ) -> Result<PreLock, SimplexProgramError> {
        let arguments = PreLockArguments::try_from(parameters)?;

        Ok(PreLock {
            program: PreLockProgram::new(internal_key, arguments),
            parameters: parameters,
        })
    }

    pub fn get_pre_lock_witness(witness_branch: &PreLockBranch) -> PreLockWitness {
        let path = match witness_branch {
            PreLockBranch::LendingCreation => Left(()),
            PreLockBranch::PreLockCancellation => Right(()),
        };

        PreLockWitness {
            path,
            signature: DUMMY_SIGNATURE,
        }
    }

    pub fn get_pre_lock_parameters(&self) -> &PreLockParameters {
        &self.parameters
    }

    pub fn encode_creation_op_return_data(&self) -> Vec<u8> {
        let mut op_return_data = Vec::with_capacity(64);
        op_return_data.extend_from_slice(&self.parameters.borrower_pubkey);
        op_return_data.extend_from_slice(&self.parameters.principal_asset_id.into_inner().0);

        op_return_data
    }
}

impl SimplexProgram for PreLock {
    fn get_program(&self) -> &Program {
        self.program.get_program()
    }

    fn get_network(&self) -> &SimplicityNetwork {
        &self.parameters.network
    }
}
