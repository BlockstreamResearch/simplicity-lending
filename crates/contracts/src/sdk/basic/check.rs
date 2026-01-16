use simplicityhl::elements::hex::ToHex;
use simplicityhl::elements::{AssetId, Script};
use simplicityhl_core::hash_script;

use crate::error::TransactionBuildError;

pub fn check_script(
    actual_script: &Script,
    expected_script_hash: [u8; 32],
) -> Result<(), TransactionBuildError> {
    let script_hash = hash_script(actual_script);
    if script_hash != expected_script_hash {
        return Err(TransactionBuildError::InvalidAssetId {
            expected: expected_script_hash.to_hex(),
            actual: script_hash.to_hex(),
        });
    }

    Ok(())
}

pub fn check_asset_id(
    actual_asset_id: AssetId,
    expected_asset_id: [u8; 32],
) -> Result<(), TransactionBuildError> {
    if actual_asset_id.into_inner().0 != expected_asset_id {
        return Err(TransactionBuildError::InvalidAssetId {
            expected: expected_asset_id.to_hex(),
            actual: actual_asset_id.to_hex(),
        });
    }

    Ok(())
}

pub fn check_asset_value(
    actual_asset_value: u64,
    expected_asset_value: u64,
) -> Result<(), TransactionBuildError> {
    if actual_asset_value != expected_asset_value {
        return Err(TransactionBuildError::InvalidAssetValue {
            expected: expected_asset_value.to_hex(),
            actual: actual_asset_value.to_hex(),
        });
    }

    Ok(())
}
