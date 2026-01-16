use simplicityhl::elements::AssetId;
use simplicityhl::elements::hex::ToHex;

use crate::error::TransactionBuildError;

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
