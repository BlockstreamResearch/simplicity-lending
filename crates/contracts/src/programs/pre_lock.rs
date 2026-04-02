use simplex::constants::DUMMY_SIGNATURE;
use simplex::either::Either::{Left, Right};
use simplex::program::Program;

use simplex::simplicityhl::elements::AssetId;
use simplex::simplicityhl::elements::hashes::FromSliceError;
use simplex::simplicityhl::elements::hex::ToHex;
use simplex::simplicityhl::elements::secp256k1_zkp::XOnlyPublicKey;
use simplex::{provider::SimplicityNetwork, utils::tr_unspendable_key};

use crate::artifacts::pre_lock::PreLockProgram;
use crate::artifacts::pre_lock::derived_pre_lock::{PreLockArguments, PreLockWitness};
use crate::programs::program::SimplexProgram;
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

impl From<PreLockParameters> for PreLockArguments {
    fn from(value: PreLockParameters) -> Self {
        let parameter_nfts_script_auth = value.get_parameter_nfts_script_auth();

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
            borrower_pub_key: value.borrower_pubkey.serialize(),
            lending_cov_hash: parameter_nfts_script_auth
                .get_script_auth_parameters()
                .script_hash,
            parameters_nft_output_script_hash: parameter_nfts_script_auth.get_script_hash(),
            borrower_nft_output_script_hash: value.borrower_output_script_hash,
            principal_output_script_hash: value.borrower_output_script_hash,
        }
    }
}

impl PreLockParameters {
    pub fn get_parameter_nfts_script_auth(&self) -> ScriptAuth {
        let lending = Lending::new(self.into());

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

#[derive(thiserror::Error, Debug)]
pub enum PreLockError {
    #[error("Invalid creation OP_RETURN data length: expected - {expected}, actual - {actual}")]
    InvalidCreationOpReturnDataLength { expected: usize, actual: usize },

    #[error("Invalid OP_RETURN borrower pubkey bytes: {0}")]
    InvalidOpReturnBytes(String),

    #[error("Failed to convert OP_RETURN asset id bytes to valid asset id: {0}")]
    FromSlice(#[from] FromSliceError),
}

pub const PRE_LOCK_CREATION_OP_RETURN_DATA_LENGTH: usize = 64;

impl PreLock {
    pub fn new(parameters: PreLockParameters) -> Self {
        Self::from_internal_key(tr_unspendable_key(), parameters)
    }

    pub fn from_internal_key(internal_key: XOnlyPublicKey, parameters: PreLockParameters) -> Self {
        let arguments = PreLockArguments::from(parameters);

        Self {
            program: PreLockProgram::new(internal_key, arguments),
            parameters,
        }
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

    pub fn decode_creation_op_return_data(
        op_return_bytes: Vec<u8>,
    ) -> Result<(XOnlyPublicKey, AssetId), PreLockError> {
        if op_return_bytes.len() != PRE_LOCK_CREATION_OP_RETURN_DATA_LENGTH {
            return Err(PreLockError::InvalidCreationOpReturnDataLength {
                expected: PRE_LOCK_CREATION_OP_RETURN_DATA_LENGTH,
                actual: op_return_bytes.len(),
            });
        }

        let (op_return_pub_key, op_return_asset_id) = op_return_bytes.split_at(32);

        let principal_asset_id = AssetId::from_slice(op_return_asset_id)?;
        let borrower_public_key = XOnlyPublicKey::from_slice(op_return_pub_key)
            .map_err(|_| PreLockError::InvalidOpReturnBytes(op_return_pub_key.to_hex()))?;

        Ok((borrower_public_key, principal_asset_id))
    }

    pub fn encode_creation_op_return_data(&self) -> Vec<u8> {
        let mut op_return_data = Vec::with_capacity(PRE_LOCK_CREATION_OP_RETURN_DATA_LENGTH);
        op_return_data.extend_from_slice(&self.parameters.borrower_pubkey.serialize());
        op_return_data.extend_from_slice(&self.parameters.principal_asset_id.into_inner().0);

        op_return_data
    }

    pub fn get_pre_lock_parameters(&self) -> &PreLockParameters {
        &self.parameters
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
