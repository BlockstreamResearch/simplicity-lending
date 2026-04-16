use simplex::constants::DUMMY_SIGNATURE;
use simplex::either::Either::{self, Left, Right};
use simplex::program::Program;
use simplex::provider::SimplicityNetwork;
use simplex::simplicityhl::elements::hex::ToHex;
use simplex::simplicityhl::elements::schnorr::XOnlyPublicKey;

use crate::artifacts::issuance_factory::IssuanceFactoryProgram;
use crate::artifacts::issuance_factory::derived_issuance_factory::{
    IssuanceFactoryArguments, IssuanceFactoryWitness,
};
use crate::programs::program::SimplexProgram;

#[derive(Debug, Clone, Copy)]
pub struct IssuanceFactoryParameters {
    pub issuing_utxos_count: u8,
    pub reissuance_flags: u64,
    pub owner_pubkey: XOnlyPublicKey,
    pub network: SimplicityNetwork,
}

impl From<IssuanceFactoryParameters> for IssuanceFactoryArguments {
    fn from(value: IssuanceFactoryParameters) -> Self {
        Self {
            issuing_utxos_count: value.issuing_utxos_count,
            reissuance_flags: value.reissuance_flags,
            factory_owner_pubkey: value.owner_pubkey.serialize(),
        }
    }
}

pub struct IssuanceFactory {
    program: IssuanceFactoryProgram,
    parameters: IssuanceFactoryParameters,
}

#[derive(Debug, Clone, Copy)]
pub enum IssuanceFactoryBranch {
    IssueAssets { output_index: u32 },
    RemoveFactory { output_index: u32 },
}

#[derive(thiserror::Error, Debug)]
pub enum IssuanceFactoryError {
    #[error("Invalid creation OP_RETURN data length: expected - {expected}, actual - {actual}")]
    InvalidCreationOpReturnDataLength { expected: usize, actual: usize },

    #[error("Invalid OP_RETURN owner pubkey bytes: {0}")]
    InvalidOpReturnBytes(String),
}

pub const ISSUANCE_FACTORY_CREATION_OP_RETURN_DATA_LENGTH: usize = 32;

impl IssuanceFactory {
    pub fn new(parameters: IssuanceFactoryParameters) -> Self {
        Self {
            program: IssuanceFactoryProgram::new(IssuanceFactoryArguments::from(parameters)),
            parameters,
        }
    }

    pub fn get_issuance_factory_witness(
        witness_branch: &IssuanceFactoryBranch,
    ) -> IssuanceFactoryWitness {
        let (output_index, path): (u32, Either<(), ()>) = match witness_branch {
            IssuanceFactoryBranch::IssueAssets { output_index } => (*output_index, Left(())),
            IssuanceFactoryBranch::RemoveFactory { output_index } => (*output_index, Right(())),
        };

        IssuanceFactoryWitness {
            path,
            output_index,
            signature: DUMMY_SIGNATURE,
        }
    }

    pub fn decode_creation_op_return_data(
        op_return_bytes: Vec<u8>,
    ) -> Result<XOnlyPublicKey, IssuanceFactoryError> {
        if op_return_bytes.len() != ISSUANCE_FACTORY_CREATION_OP_RETURN_DATA_LENGTH {
            return Err(IssuanceFactoryError::InvalidCreationOpReturnDataLength {
                expected: ISSUANCE_FACTORY_CREATION_OP_RETURN_DATA_LENGTH,
                actual: op_return_bytes.len(),
            });
        }

        let owner_pubkey = XOnlyPublicKey::from_slice(op_return_bytes.as_slice())
            .map_err(|_| IssuanceFactoryError::InvalidOpReturnBytes(op_return_bytes.to_hex()))?;

        Ok(owner_pubkey)
    }

    pub fn encode_creation_op_return_data(&self) -> Vec<u8> {
        let mut op_return_data =
            Vec::with_capacity(ISSUANCE_FACTORY_CREATION_OP_RETURN_DATA_LENGTH);
        op_return_data.extend_from_slice(&self.parameters.owner_pubkey.serialize());

        op_return_data
    }

    pub fn get_issuance_factory_parameters(&self) -> &IssuanceFactoryParameters {
        &self.parameters
    }
}

impl SimplexProgram for IssuanceFactory {
    fn get_program(&self) -> &Program {
        self.program.get_program()
    }

    fn get_network(&self) -> &SimplicityNetwork {
        &self.parameters.network
    }
}
