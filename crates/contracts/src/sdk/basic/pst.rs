use simplicityhl::elements::pset::{Input, PartiallySignedTransaction};
use simplicityhl::elements::{OutPoint, Sequence, TxOut};

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