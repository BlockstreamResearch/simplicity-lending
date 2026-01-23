use simplicity_contracts::sdk::validation::TxOutExt;

use simplicityhl::elements::hex::ToHex;
use simplicityhl::elements::pset::{Input, Output, PartiallySignedTransaction};
use simplicityhl::elements::{OutPoint, Script, Sequence, TxOut};

use crate::asset_auth::build_arguments::AssetAuthArguments;
use crate::asset_auth::build_witness::AssetAuthWitnessParams;
use crate::error::{AssetAuthError, TransactionBuildError};

/// Unlock `AssetAuth` UTXO by providing auth UTXO with the needed asset id and amount
///
/// # Errors
///
/// Returns an error if:
/// - The UTXO values are not explicit
/// - The fee UTXO does not have enough fee value
/// - The taproot pubkey generation fails
/// - The passed auth UTXO has an invalid asset id or amount
pub fn build_asset_auth_unlock(
    locked_utxo: (OutPoint, TxOut),
    auth_utxo: (OutPoint, TxOut),
    fee_utxo: (OutPoint, TxOut),
    asset_auth_arguments: &AssetAuthArguments,
    fee_amount: u64,
) -> Result<(PartiallySignedTransaction, AssetAuthWitnessParams), TransactionBuildError> {
    let (locked_out_point, locked_tx_out) = locked_utxo;
    let (auth_out_point, auth_tx_out) = auth_utxo;
    let (fee_out_point, fee_tx_out) = fee_utxo;

    let (locked_asset_id, locked_value) = locked_tx_out.explicit()?;
    let (auth_asset_id, auth_value) = auth_tx_out.explicit()?;
    let (fee_asset_id, total_lbtc_left) = (
        fee_tx_out.explicit_asset()?,
        fee_tx_out.validate_amount(fee_amount)?,
    );

    if auth_asset_id.into_inner().0 != asset_auth_arguments.asset_id {
        return Err(TransactionBuildError::AssetAuth(
            AssetAuthError::InvalidAuthAssetId {
                expected: asset_auth_arguments.asset_id.to_hex(),
                actual: auth_asset_id.to_string(),
            },
        ));
    }

    auth_tx_out.validate_amount(asset_auth_arguments.asset_amount)?;

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

    let mut auth_output = Output::new_explicit(
        auth_tx_out.script_pubkey.clone(),
        auth_value,
        auth_asset_id,
        None,
    );

    if asset_auth_arguments.with_asset_burn {
        auth_output.script_pubkey = Script::new_op_return(b"burn");
    }

    pst.add_output(auth_output);

    if is_lbtc_change_needed {
        pst.add_output(Output::new_explicit(
            change_recipient_script,
            total_lbtc_left,
            fee_asset_id,
            None,
        ));
    }

    pst.add_output(Output::new_explicit(
        Script::new(),
        fee_amount,
        fee_asset_id,
        None,
    ));

    let witness_params = AssetAuthWitnessParams {
        input_asset_index: 1,
        output_asset_index: 1,
    };

    Ok((pst, witness_params))
}
