use simplicity_contracts::sdk::validation::TxOutExt;

use crate::error::TransactionBuildError;
use crate::sdk::basic::add_base_input_from_utxo;
use simplicityhl::elements::pset::{Output, PartiallySignedTransaction};
use simplicityhl::elements::{OutPoint, Script, TxOut};

/// Prepare four UTXOs for utility NFTs issuance
///
/// # Errors
///
/// Returns an error if:
/// - The UTXO values are not explicit
/// - The fee UTXO does not have enough value
pub fn build_utility_nfts_issuance_preparation(
    fee_utxo: (OutPoint, TxOut),
    issuance_utxos_output_script: &Script,
    fee_amount: u64,
) -> Result<PartiallySignedTransaction, TransactionBuildError> {
    let (fee_out_point, fee_tx_out) = fee_utxo;

    let issuance_utxos_count = 4;
    let (fee_asset_id, total_lbtc_left) = (
        fee_tx_out.explicit_asset()?,
        fee_tx_out.validate_amount(fee_amount + issuance_utxos_count)?,
    );

    let change_recipient_script = fee_tx_out.script_pubkey.clone();

    let mut pst = PartiallySignedTransaction::new_v2();

    // Inputs setup

    // Add Fee input
    add_base_input_from_utxo(&mut pst, fee_out_point, fee_tx_out, None);

    // Outputs setup

    let is_lbtc_change_needed = total_lbtc_left != 0;

    // Add First issuance UTXO output
    pst.add_output(Output::new_explicit(
        issuance_utxos_output_script.clone(),
        1,
        fee_asset_id,
        None,
    ));

    // Add Second issuance UTXO output
    pst.add_output(Output::new_explicit(
        issuance_utxos_output_script.clone(),
        1,
        fee_asset_id,
        None,
    ));

    // Add Third issuance UTXO output
    pst.add_output(Output::new_explicit(
        issuance_utxos_output_script.clone(),
        1,
        fee_asset_id,
        None,
    ));

    // Add Fourth issuance UTXO output
    pst.add_output(Output::new_explicit(
        issuance_utxos_output_script.clone(),
        1,
        fee_asset_id,
        None,
    ));

    // Fee outputs
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

    Ok(pst)
}
