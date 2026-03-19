#![allow(dead_code)]
use simplex::simplicityhl::elements::{AssetId, TxOut};

pub fn assert_burn_output(output: &TxOut, asset_id: AssetId, amount: u64) {
    assert!(output.is_null_data());
    assert_eq!(output.asset.explicit().unwrap(), asset_id);
    assert_eq!(output.value.explicit().unwrap(), amount);
}
