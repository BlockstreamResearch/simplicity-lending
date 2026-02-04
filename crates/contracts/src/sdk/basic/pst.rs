use simplicityhl::elements::locktime::Height;
use simplicityhl::elements::pset::{Input, PartiallySignedTransaction};
use simplicityhl::elements::{AssetId, OutPoint, Sequence, TxOut};
use simplicityhl_core::get_new_asset_entropy;

pub fn add_base_input_from_utxo(
    pst: &mut PartiallySignedTransaction,
    utxo_out_point: OutPoint,
    utxo_tx_out: TxOut,
    required_height: Option<Height>,
) {
    let mut new_input = Input::from_prevout(utxo_out_point);
    new_input.witness_utxo = Some(utxo_tx_out);
    new_input.sequence = Some(Sequence::ENABLE_LOCKTIME_NO_RBF);
    new_input.required_height_locktime = required_height;
    pst.add_input(new_input);
}

pub fn add_nft_issuance_input_from_utxo(
    pst: &mut PartiallySignedTransaction,
    utxo_out_point: OutPoint,
    utxo_tx_out: TxOut,
    issuance_amount: u64,
    issuance_asset_entropy: [u8; 32],
) -> AssetId {
    let mut new_issuance_input = Input::from_prevout(utxo_out_point);
    new_issuance_input.witness_utxo = Some(utxo_tx_out);
    new_issuance_input.issuance_value_amount = Some(issuance_amount);
    new_issuance_input.issuance_inflation_keys = None;
    new_issuance_input.issuance_asset_entropy = Some(issuance_asset_entropy);
    new_issuance_input.blinded_issuance = Some(0x00);
    new_issuance_input.sequence = Some(Sequence::MAX);
    pst.add_input(new_issuance_input);

    AssetId::from_entropy(get_new_asset_entropy(
        &utxo_out_point,
        issuance_asset_entropy,
    ))
}
