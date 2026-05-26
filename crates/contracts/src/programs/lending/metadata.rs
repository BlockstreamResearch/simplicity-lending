use simplex::simplicityhl::elements::AssetId;

use crate::programs::{
    lending::{LendingOffer, LendingOfferError, OfferParameters},
    program::{CreationMetadata, MetadataProgram, PROGRAM_ID_LENGTH, ProgramId, SimplexProgram},
};

const LENDING_OFFER_CREATION_METADATA_LENGTH: usize = 50;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LendingOfferCreationMetadata {
    pub program_id: ProgramId,
    pub principal_asset_id: AssetId,
    pub principal_amount: u64,
    pub loan_expiration_time: u32,
    pub principal_interest_rate: u16,
}

impl LendingOfferCreationMetadata {
    pub fn new(
        program_id: ProgramId,
        principal_asset_id: AssetId,
        offer_parameters: OfferParameters,
    ) -> Self {
        Self {
            program_id,
            principal_asset_id,
            principal_amount: offer_parameters.principal_amount,
            loan_expiration_time: offer_parameters.loan_expiration_time,
            principal_interest_rate: offer_parameters.principal_interest_rate,
        }
    }
}

impl CreationMetadata for LendingOfferCreationMetadata {
    type Error = LendingOfferError;

    const DATA_LENGTH: usize = LENDING_OFFER_CREATION_METADATA_LENGTH;

    fn decode(op_return_bytes: &[u8]) -> Result<Self, Self::Error> {
        Self::validate_length(op_return_bytes, |expected, actual| {
            LendingOfferError::InvalidCreationMetadataLength { expected, actual }
        })?;

        let mut cursor = 0;

        let program_id = Self::decode_program_id(op_return_bytes);
        cursor += PROGRAM_ID_LENGTH;

        let principal_asset_id_raw = &op_return_bytes[cursor..cursor + 32];
        cursor += 32;

        let principal_amount = u64::from_le_bytes(
            op_return_bytes[cursor..cursor + std::mem::size_of::<u64>()]
                .try_into()
                .expect("u64 length is fixed"),
        );
        cursor += std::mem::size_of::<u64>();

        let loan_expiration_time = u32::from_le_bytes(
            op_return_bytes[cursor..cursor + std::mem::size_of::<u32>()]
                .try_into()
                .expect("u32 length is fixed"),
        );
        cursor += std::mem::size_of::<u32>();

        let principal_interest_rate = u16::from_le_bytes(
            op_return_bytes[cursor..cursor + std::mem::size_of::<u16>()]
                .try_into()
                .expect("u16 length is fixed"),
        );

        Ok(Self {
            program_id,
            principal_asset_id: AssetId::from_slice(principal_asset_id_raw)?,
            principal_amount,
            loan_expiration_time,
            principal_interest_rate,
        })
    }

    fn encode(&self) -> Vec<u8> {
        let mut op_return_data = Vec::with_capacity(Self::DATA_LENGTH);
        op_return_data.extend_from_slice(&self.program_id);
        op_return_data.extend_from_slice(&self.principal_asset_id.into_inner().0);
        op_return_data.extend_from_slice(&self.principal_amount.to_le_bytes());
        op_return_data.extend_from_slice(&self.loan_expiration_time.to_le_bytes());
        op_return_data.extend_from_slice(&self.principal_interest_rate.to_le_bytes());

        op_return_data
    }
}

impl MetadataProgram for LendingOffer {
    type Metadata = LendingOfferCreationMetadata;

    fn build_metadata(&self) -> Self::Metadata {
        let parameters = self.get_parameters();

        LendingOfferCreationMetadata::new(
            Self::get_program_id(),
            parameters.principal_asset_id,
            parameters.offer_parameters,
        )
    }
}
