use sha2::{Digest, Sha256};
use simplicityhl::elements::hex::ToHex;

use crate::error::PreLockError;
use crate::pre_lock::build_arguments::PreLockArguments;

pub const PRE_LOCK_METADATA_LEN: usize = 64;

#[derive(Debug, Clone, PartialEq, Eq)]
enum BorrowerOutputMetadata {
    Hash([u8; 32]),
    Script(Vec<u8>),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreLockMetadata {
    borrower_pub_key: [u8; 32],
    principal_asset_id: [u8; 32],
    borrower_output_metadata: Option<BorrowerOutputMetadata>,
}

impl PreLockMetadata {
    #[must_use]
    pub const fn new_legacy(borrower_pub_key: [u8; 32], principal_asset_id: [u8; 32]) -> Self {
        Self {
            borrower_pub_key,
            principal_asset_id,
            borrower_output_metadata: None,
        }
    }

    #[must_use]
    pub const fn new_with_hash(
        borrower_pub_key: [u8; 32],
        principal_asset_id: [u8; 32],
        borrower_output_script_hash: [u8; 32],
    ) -> Self {
        Self {
            borrower_pub_key,
            principal_asset_id,
            borrower_output_metadata: Some(BorrowerOutputMetadata::Hash(
                borrower_output_script_hash,
            )),
        }
    }

    #[must_use]
    pub fn new_with_script(
        borrower_pub_key: [u8; 32],
        principal_asset_id: [u8; 32],
        borrower_output_script: Vec<u8>,
    ) -> Self {
        Self {
            borrower_pub_key,
            principal_asset_id,
            borrower_output_metadata: Some(BorrowerOutputMetadata::Script(borrower_output_script)),
        }
    }

    /// Builds pre-lock metadata from canonical pre-lock arguments.
    ///
    /// # Errors
    ///
    /// Returns an error when the borrower NFT and principal outputs do not share the
    /// same script hash, or when a provided borrower output script does not match that hash.
    pub fn from_pre_lock_arguments(
        pre_lock_arguments: &PreLockArguments,
        borrower_output_script: Option<&[u8]>,
    ) -> Result<Self, PreLockError> {
        let borrower_nft_output_script_hash = pre_lock_arguments.borrower_nft_output_script_hash();
        let principal_output_script_hash = pre_lock_arguments.principal_output_script_hash();

        if borrower_nft_output_script_hash != principal_output_script_hash {
            return Err(PreLockError::InconsistentBorrowerOutputScriptHashes {
                borrower_nft_output_script_hash: borrower_nft_output_script_hash.to_hex(),
                principal_output_script_hash: principal_output_script_hash.to_hex(),
            });
        }

        if let Some(borrower_output_script) = borrower_output_script {
            let actual_hash = hash_script_bytes(borrower_output_script);
            if actual_hash != principal_output_script_hash {
                return Err(PreLockError::BorrowerOutputScriptHashMismatch {
                    expected_hash: principal_output_script_hash.to_hex(),
                    actual_hash: actual_hash.to_hex(),
                });
            }

            return Ok(Self::new_with_script(
                pre_lock_arguments.borrower_pub_key(),
                pre_lock_arguments.principal_asset_id(),
                borrower_output_script.to_vec(),
            ));
        }

        Ok(Self::new_with_hash(
            pre_lock_arguments.borrower_pub_key(),
            pre_lock_arguments.principal_asset_id(),
            principal_output_script_hash,
        ))
    }

    #[must_use]
    pub const fn borrower_pub_key(&self) -> [u8; 32] {
        self.borrower_pub_key
    }

    #[must_use]
    pub const fn principal_asset_id(&self) -> [u8; 32] {
        self.principal_asset_id
    }

    #[must_use]
    pub fn borrower_output_script_hash(&self) -> Option<[u8; 32]> {
        match &self.borrower_output_metadata {
            Some(BorrowerOutputMetadata::Hash(hash)) => Some(*hash),
            Some(BorrowerOutputMetadata::Script(script)) => Some(hash_script_bytes(script)),
            None => None,
        }
    }

    #[must_use]
    pub fn borrower_output_script(&self) -> Option<&[u8]> {
        match &self.borrower_output_metadata {
            Some(BorrowerOutputMetadata::Script(script)) => Some(script.as_slice()),
            _ => None,
        }
    }

    #[must_use]
    pub fn encode(&self) -> [u8; PRE_LOCK_METADATA_LEN] {
        let mut bytes = [0u8; PRE_LOCK_METADATA_LEN];
        bytes[..32].copy_from_slice(&self.borrower_pub_key);
        bytes[32..].copy_from_slice(&self.principal_asset_id);
        bytes
    }

    #[must_use]
    pub fn encode_borrower_output_metadata(&self) -> Option<Vec<u8>> {
        match &self.borrower_output_metadata {
            Some(BorrowerOutputMetadata::Hash(hash)) => Some(hash.to_vec()),
            Some(BorrowerOutputMetadata::Script(script)) => Some(script.clone()),
            None => None,
        }
    }
}

fn hash_script_bytes(bytes: &[u8]) -> [u8; 32] {
    let digest = Sha256::digest(bytes);
    let mut hash = [0u8; 32];
    hash.copy_from_slice(&digest);
    hash
}

/// Decodes the `OP_RETURN` metadata emitted by the pre-lock creation transaction.
///
/// # Errors
///
/// Returns an error when the primary metadata length is invalid or when the optional
/// borrower output metadata is malformed.
pub fn decode_pre_lock_metadata(
    bytes: &[u8],
    borrower_output_metadata_bytes: Option<&[u8]>,
) -> Result<PreLockMetadata, PreLockError> {
    if bytes.len() != PRE_LOCK_METADATA_LEN {
        return Err(PreLockError::InvalidOpReturnBytes {
            bytes: bytes.to_hex(),
        });
    }

    let borrower_pub_key =
        bytes[..32]
            .try_into()
            .map_err(|_| PreLockError::InvalidOpReturnBytes {
                bytes: bytes.to_hex(),
            })?;
    let principal_asset_id =
        bytes[32..]
            .try_into()
            .map_err(|_| PreLockError::InvalidOpReturnBytes {
                bytes: bytes.to_hex(),
            })?;

    let borrower_output_metadata = borrower_output_metadata_bytes
        .map(|bytes| {
            if bytes.len() == 32 {
                bytes
                    .try_into()
                    .map(BorrowerOutputMetadata::Hash)
                    .map_err(|_| PreLockError::InvalidOpReturnBytes {
                        bytes: bytes.to_hex(),
                    })
            } else if bytes.is_empty() {
                Err(PreLockError::InvalidOpReturnBytes {
                    bytes: bytes.to_hex(),
                })
            } else {
                Ok(BorrowerOutputMetadata::Script(bytes.to_vec()))
            }
        })
        .transpose()?;

    Ok(PreLockMetadata {
        borrower_pub_key,
        principal_asset_id,
        borrower_output_metadata,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_legacy_metadata() {
        let borrower_pub_key = [1u8; 32];
        let principal_asset_id = [2u8; 32];
        let mut bytes = [0u8; PRE_LOCK_METADATA_LEN];
        bytes[..32].copy_from_slice(&borrower_pub_key);
        bytes[32..].copy_from_slice(&principal_asset_id);

        let metadata =
            decode_pre_lock_metadata(&bytes, None).expect("legacy metadata should decode");

        assert_eq!(metadata.borrower_pub_key(), borrower_pub_key);
        assert_eq!(metadata.principal_asset_id(), principal_asset_id);
        assert_eq!(metadata.borrower_output_script_hash(), None);
        assert_eq!(metadata.borrower_output_script(), None);
    }

    #[test]
    fn decodes_hash_only_metadata() {
        let borrower_pub_key = [1u8; 32];
        let principal_asset_id = [2u8; 32];
        let borrower_output_script_hash = [3u8; 32];
        let metadata = PreLockMetadata::new_with_hash(
            borrower_pub_key,
            principal_asset_id,
            borrower_output_script_hash,
        );

        let decoded = decode_pre_lock_metadata(
            &metadata.encode(),
            metadata
                .encode_borrower_output_metadata()
                .as_ref()
                .map(AsRef::as_ref),
        )
        .expect("hash-only metadata should round-trip");

        assert_eq!(decoded, metadata);
        assert_eq!(decoded.borrower_output_script(), None);
    }

    #[test]
    fn decodes_script_metadata() {
        let borrower_pub_key = [1u8; 32];
        let principal_asset_id = [2u8; 32];
        let borrower_output_script = vec![0x00, 0x14];
        let metadata = PreLockMetadata::new_with_script(
            borrower_pub_key,
            principal_asset_id,
            borrower_output_script.clone(),
        );

        let decoded = decode_pre_lock_metadata(
            &metadata.encode(),
            metadata
                .encode_borrower_output_metadata()
                .as_ref()
                .map(AsRef::as_ref),
        )
        .expect("script metadata should round-trip");

        assert_eq!(decoded, metadata);
        assert_eq!(
            decoded.borrower_output_script(),
            Some(borrower_output_script.as_slice())
        );
    }
}
