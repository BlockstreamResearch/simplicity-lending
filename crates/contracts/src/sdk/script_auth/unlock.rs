use simplicity_contracts::sdk::validation::TxOutExt;

use simplicityhl::elements::hex::ToHex;
use simplicityhl::elements::pset::{Input, Output, PartiallySignedTransaction};
use simplicityhl::elements::{OutPoint, Sequence, TxOut};
use simplicityhl_core::hash_script;

use crate::error::{ScriptAuthError, TransactionBuildError};
use crate::script_auth::build_arguments::ScriptAuthArguments;
use crate::script_auth::build_witness::ScriptAuthWitnessParams;

pub fn build_script_auth_unlock(
    locked_utxo: (OutPoint, TxOut),
    auth_utxo: (OutPoint, TxOut),
    fee_utxo: (OutPoint, TxOut),
    script_auth_arguments: &ScriptAuthArguments,
    fee_amount: u64,
) -> Result<(PartiallySignedTransaction, ScriptAuthWitnessParams), TransactionBuildError> {
    let (locked_out_point, locked_tx_out) = locked_utxo;
    let (auth_out_point, auth_tx_out) = auth_utxo;
    let (fee_out_point, fee_tx_out) = fee_utxo;

    let (locked_asset_id, locked_value) = locked_tx_out.explicit()?;
    let (auth_asset_id, auth_value) = auth_tx_out.explicit()?;
    let (fee_asset_id, total_lbtc_left) = (
        fee_tx_out.explicit_asset()?,
        fee_tx_out.validate_amount(fee_amount)?,
    );

    let passed_auth_script_hash = hash_script(&auth_tx_out.script_pubkey);

    if passed_auth_script_hash != script_auth_arguments.script_hash {
        return Err(TransactionBuildError::ScriptAuth(
            ScriptAuthError::InvalidAuthScriptHash {
                expected: script_auth_arguments.script_hash.to_hex(),
                actual: passed_auth_script_hash.to_hex(),
            },
        ));
    }

    let change_recipient_script = fee_tx_out.script_pubkey.clone();

    let mut pst = PartiallySignedTransaction::new_v2();

    let mut locked_input = Input::from_prevout(locked_out_point);
    locked_input.witness_utxo = Some(locked_tx_out.clone());
    locked_input.sequence = Some(Sequence::ENABLE_LOCKTIME_NO_RBF);
    pst.add_input(locked_input);

    let mut auth_input = Input::from_prevout(auth_out_point);
    auth_input.witness_utxo = Some(auth_tx_out.clone());
    auth_input.sequence = Some(Sequence::ENABLE_LOCKTIME_NO_RBF);
    pst.add_input(auth_input);

    let mut fee_input = Input::from_prevout(fee_out_point);
    fee_input.witness_utxo = Some(fee_tx_out.clone());
    fee_input.sequence = Some(Sequence::ENABLE_LOCKTIME_NO_RBF);
    pst.add_input(fee_input);

    let is_lbtc_change_needed = total_lbtc_left != 0;

    pst.add_output(Output::new_explicit(
        auth_tx_out.script_pubkey.clone(),
        locked_value,
        locked_asset_id,
        None,
    ));

    pst.add_output(Output::new_explicit(
        auth_tx_out.script_pubkey.clone(),
        auth_value,
        auth_asset_id,
        None,
    ));

    if is_lbtc_change_needed {
        pst.add_output(Output::new_explicit(
            change_recipient_script,
            total_lbtc_left,
            fee_asset_id,
            None,
        ));
    }

    let witness_params = ScriptAuthWitnessParams {
        input_script_index: 1,
    };

    Ok((pst, witness_params))
}
