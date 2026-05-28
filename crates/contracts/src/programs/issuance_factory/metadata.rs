use crate::programs::issuance_factory::{IssuanceFactory, IssuanceFactoryError};
use crate::programs::program::{
    CreationMetadata, MetadataProgram, PROGRAM_ID_LENGTH, ProgramId, SimplexProgram,
};

const CREATION_OP_RETURN_DATA_LENGTH: usize =
    PROGRAM_ID_LENGTH + std::mem::size_of::<u8>() + std::mem::size_of::<u64>();

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct IssuanceFactoryCreationMetadata {
    pub program_id: ProgramId,
    pub issuing_utxos_count: u8,
    pub reissuance_flags: u64,
}

impl IssuanceFactoryCreationMetadata {
    pub fn new(program_id: ProgramId, issuing_utxos_count: u8, reissuance_flags: u64) -> Self {
        Self {
            program_id,
            issuing_utxos_count,
            reissuance_flags,
        }
    }
}

impl CreationMetadata for IssuanceFactoryCreationMetadata {
    type Error = IssuanceFactoryError;

    const DATA_LENGTH: usize = CREATION_OP_RETURN_DATA_LENGTH;

    fn decode(op_return_bytes: &[u8]) -> Result<Self, Self::Error> {
        Self::validate_length(op_return_bytes, |expected, actual| {
            IssuanceFactoryError::InvalidCreationMetadataLength { expected, actual }
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

        Ok(Self {
            program_id,
            issuing_utxos_count,
            reissuance_flags,
        })
    }

    fn encode(&self) -> Vec<u8> {
        let mut op_return_data = Vec::with_capacity(Self::DATA_LENGTH);
        op_return_data.extend_from_slice(&self.program_id);
        op_return_data.push(self.issuing_utxos_count);
        op_return_data.extend_from_slice(&self.reissuance_flags.to_le_bytes());

        op_return_data
    }
}

impl MetadataProgram for IssuanceFactory {
    type Metadata = IssuanceFactoryCreationMetadata;

    fn build_metadata(&self) -> Self::Metadata {
        let parameters = self.get_parameters();

        IssuanceFactoryCreationMetadata::new(
            Self::get_program_id(),
            parameters.issuing_utxos_count,
            parameters.reissuance_flags,
        )
    }
}
