use simplex::simplicityhl::elements::{AssetId, hex::ToHex, secp256k1_zkp::XOnlyPublicKey};

use crate::programs::pre_lock::{PreLock, PreLockError};
use crate::programs::program::{
    CreationOpReturnData, PROGRAM_ID_LENGTH, ProgramId, SimplexProgram,
};

const PRE_LOCK_CREATION_OP_RETURN_DATA_LENGTH: usize = 68;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PreLockCreationOpReturnData {
    pub program_id: ProgramId,
    pub borrower_pubkey: XOnlyPublicKey,
    pub principal_asset_id: AssetId,
}

impl PreLockCreationOpReturnData {
    pub fn new(
        program_id: ProgramId,
        borrower_pubkey: XOnlyPublicKey,
        principal_asset_id: AssetId,
    ) -> Self {
        Self {
            program_id,
            borrower_pubkey,
            principal_asset_id,
        }
    }

    fn decode_borrower_pubkey(op_return_pub_key: &[u8]) -> Result<XOnlyPublicKey, PreLockError> {
        XOnlyPublicKey::from_slice(op_return_pub_key)
            .map_err(|_| PreLockError::InvalidOpReturnBytes(op_return_pub_key.to_hex()))
    }
}

impl CreationOpReturnData for PreLockCreationOpReturnData {
    type Error = PreLockError;

    const DATA_LENGTH: usize = PRE_LOCK_CREATION_OP_RETURN_DATA_LENGTH;

    fn decode(op_return_bytes: &[u8]) -> Result<Self, Self::Error> {
        Self::validate_length(op_return_bytes, |expected, actual| {
            PreLockError::InvalidCreationOpReturnDataLength { expected, actual }
        })?;

        let program_id = Self::decode_program_id(op_return_bytes);
        let borrower_pubkey = &op_return_bytes[PROGRAM_ID_LENGTH..36];
        let principal_asset_id = &op_return_bytes[36..68];

        Ok(Self {
            program_id,
            borrower_pubkey: Self::decode_borrower_pubkey(borrower_pubkey)?,
            principal_asset_id: AssetId::from_slice(principal_asset_id)?,
        })
    }

    fn encode(&self) -> Vec<u8> {
        let mut op_return_data = Vec::with_capacity(Self::DATA_LENGTH);
        op_return_data.extend_from_slice(&self.program_id);
        op_return_data.extend_from_slice(&self.borrower_pubkey.serialize());
        op_return_data.extend_from_slice(&self.principal_asset_id.into_inner().0);

        op_return_data
    }
}

impl PreLock {
    pub fn decode_creation_op_return_data(
        op_return_bytes: Vec<u8>,
    ) -> Result<PreLockCreationOpReturnData, PreLockError> {
        PreLockCreationOpReturnData::decode(&op_return_bytes)
    }

    pub fn encode_creation_op_return_data(&self) -> Vec<u8> {
        PreLockCreationOpReturnData::new(
            self.get_program_id(),
            self.get_parameters().borrower_pubkey,
            self.get_parameters().principal_asset_id,
        )
        .encode()
    }
}
