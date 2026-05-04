use simplex::simplicityhl::elements::{
    AssetId, LockTime, Script, Transaction, TxIn, TxOut, confidential,
};

pub(crate) fn null_output() -> TxOut {
    TxOut {
        script_pubkey: Script::new_op_return(b"burn"),
        ..Default::default()
    }
}

pub(crate) fn normal_output() -> TxOut {
    TxOut::default()
}

pub(crate) fn explicit_asset_output(asset_byte: u8) -> TxOut {
    let mut output = normal_output();
    let asset_id = AssetId::from_slice(&[asset_byte; 32]).expect("valid asset id");
    output.asset = confidential::Asset::Explicit(asset_id);
    output
}

pub(crate) fn make_tx(outputs: Vec<TxOut>) -> Transaction {
    make_tx_with_inputs(1, outputs)
}

pub(crate) fn make_tx_with_inputs(inputs_count: usize, outputs: Vec<TxOut>) -> Transaction {
    Transaction {
        version: 2,
        lock_time: LockTime::ZERO,
        input: vec![TxIn::default(); inputs_count],
        output: outputs,
    }
}
