use simplicityhl::elements::hex::ToHex;
use simplicityhl::elements::pset::{Input, PartiallySignedTransaction};
use simplicityhl::elements::{AssetId, OutPoint, Sequence, TxOut};

use crate::error::TransactionBuildError;

pub fn add_base_input_from_utxo(
    pst: &mut PartiallySignedTransaction,
    utxo_out_point: OutPoint,
    utxo_tx_out: TxOut,
) {
    let mut new_input = Input::from_prevout(utxo_out_point);
    new_input.witness_utxo = Some(utxo_tx_out.clone());
    new_input.sequence = Some(Sequence::ENABLE_LOCKTIME_NO_RBF);
    pst.add_input(new_input);
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
