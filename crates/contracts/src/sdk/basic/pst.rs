use simplicityhl::elements::locktime::Height;
use simplicityhl::elements::pset::{Input, PartiallySignedTransaction};
use simplicityhl::elements::{OutPoint, Sequence, TxOut};

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
