use simplex::simplicityhl::elements::{hex::ToHex, schnorr::XOnlyPublicKey};

use crate::programs::issuance_factory::{IssuanceFactory, IssuanceFactoryError};
use crate::programs::program::{
    CreationOpReturnData, PROGRAM_ID_LENGTH, ProgramId, SimplexProgram,
};

pub(crate) const CREATION_OP_RETURN_OUTPUT_INDEX: usize = 1;

const OWNER_PUBKEY_LENGTH: usize = 32;
const CREATION_OP_RETURN_DATA_LENGTH: usize = PROGRAM_ID_LENGTH
    + std::mem::size_of::<u8>()
    + std::mem::size_of::<u64>()
    + OWNER_PUBKEY_LENGTH;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct IssuanceFactoryCreationOpReturnData {
    pub program_id: ProgramId,
    pub issuing_utxos_count: u8,
    pub reissuance_flags: u64,
    pub owner_pubkey: XOnlyPublicKey,
}

impl IssuanceFactoryCreationOpReturnData {
    pub fn new(
        program_id: ProgramId,
        issuing_utxos_count: u8,
        reissuance_flags: u64,
        owner_pubkey: XOnlyPublicKey,
    ) -> Self {
        Self {
            program_id,
            issuing_utxos_count,
            reissuance_flags,
            owner_pubkey,
        }
    }
}

impl CreationOpReturnData for IssuanceFactoryCreationOpReturnData {
    type Error = IssuanceFactoryError;

    const DATA_LENGTH: usize = CREATION_OP_RETURN_DATA_LENGTH;

    fn decode(op_return_bytes: &[u8]) -> Result<Self, Self::Error> {
        Self::validate_length(op_return_bytes, |expected, actual| {
            IssuanceFactoryError::InvalidCreationOpReturnDataLength { expected, actual }
        })?;

        let mut cursor = 0;

        let program_id = Self::decode_program_id(op_return_bytes);
        cursor += PROGRAM_ID_LENGTH;

        let issuing_utxos_count = op_return_bytes[cursor];
        cursor += std::mem::size_of::<u8>();

        let reissuance_flags = u64::from_le_bytes(
            op_return_bytes[cursor..cursor + std::mem::size_of::<u64>()]
                .try_into()
                .expect("reissuance flags length is fixed"),
        );
        cursor += std::mem::size_of::<u64>();

        let owner_pubkey_bytes = &op_return_bytes[cursor..];
        let owner_pubkey = XOnlyPublicKey::from_slice(owner_pubkey_bytes)
            .map_err(|_| IssuanceFactoryError::InvalidOpReturnBytes(op_return_bytes.to_hex()))?;

        Ok(Self {
            program_id,
            issuing_utxos_count,
            reissuance_flags,
            owner_pubkey,
        })
    }

    fn encode(&self) -> Vec<u8> {
        let mut op_return_data = Vec::with_capacity(Self::DATA_LENGTH);
        op_return_data.extend_from_slice(&self.program_id);
        op_return_data.push(self.issuing_utxos_count);
        op_return_data.extend_from_slice(&self.reissuance_flags.to_le_bytes());
        op_return_data.extend_from_slice(&self.owner_pubkey.serialize());

        op_return_data
    }
}

impl IssuanceFactory {
    pub fn decode_creation_op_return_data(
        op_return_bytes: Vec<u8>,
    ) -> Result<IssuanceFactoryCreationOpReturnData, IssuanceFactoryError> {
        IssuanceFactoryCreationOpReturnData::decode(&op_return_bytes)
    }

    pub fn encode_creation_op_return_data(&self) -> Vec<u8> {
        IssuanceFactoryCreationOpReturnData::new(
            self.get_program_id(),
            self.get_parameters().issuing_utxos_count,
            self.get_parameters().reissuance_flags,
            self.get_parameters().owner_pubkey,
        )
        .encode()
    }
}
