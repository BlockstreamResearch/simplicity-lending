use simplicity_contracts::sdk::validation::TxOutExt;

use simplicityhl::elements::pset::{Output, PartiallySignedTransaction};
use simplicityhl::elements::{OutPoint, Script, TxOut};

use crate::error::TransactionBuildError;
use crate::pre_lock::build_arguments::PreLockArguments;
use crate::sdk::basic::{add_base_input_from_utxo, check_asset_id, check_asset_value};
use crate::sdk::parameters::{FirstNFTParameters, SecondNFTParameters};

/// Cancel a pre lock contract and return locked collateral.
///
/// # Errors
///
/// Returns an error if:
/// - The UTXO values are not explicit
/// - The fee UTXO does not have enough fee value
/// - The taproot pubkey generation fails
/// - The parameters NFT values validation fails
/// - Passed UTXOs asset ids and values differ from the arguments
#[allow(clippy::too_many_arguments)]
#[allow(clippy::too_many_lines)]
pub fn build_pre_lock_cancellation(
    pre_lock_utxo: (OutPoint, TxOut),
    first_parameters_nft_utxo: (OutPoint, TxOut),
    second_parameters_nft_utxo: (OutPoint, TxOut),
    borrower_nft_utxo: (OutPoint, TxOut),
    lender_nft_utxo: (OutPoint, TxOut),
    fee_utxo: (OutPoint, TxOut),
    pre_lock_arguments: &PreLockArguments,
    collateral_output_script: &Script,
    fee_amount: u64,
) -> Result<PartiallySignedTransaction, TransactionBuildError> {
    let (pre_lock_out_point, pre_lock_tx_out) = pre_lock_utxo;
    let (first_parameters_nft_out_point, first_parameters_nft_tx_out) = first_parameters_nft_utxo;
    let (second_parameters_nft_out_point, second_parameters_nft_tx_out) =
        second_parameters_nft_utxo;
    let (borrower_nft_out_point, borrower_nft_tx_out) = borrower_nft_utxo;
    let (lender_nft_out_point, lender_nft_tx_out) = lender_nft_utxo;
    let (fee_out_point, fee_tx_out) = fee_utxo;

    let (pre_lock_asset_id, pre_lock_value) = pre_lock_tx_out.explicit()?;
    let (first_parameters_nft_asset_id, first_parameters_nft_value) =
        first_parameters_nft_tx_out.explicit()?;
    let (second_parameters_nft_asset_id, second_parameters_nft_value) =
        second_parameters_nft_tx_out.explicit()?;
    let (borrower_nft_asset_id, borrower_nft_value) = borrower_nft_tx_out.explicit()?;
    let (lender_nft_asset_id, lender_nft_value) = lender_nft_tx_out.explicit()?;
    let (fee_asset_id, total_lbtc_left) = (
        fee_tx_out.explicit_asset()?,
        fee_tx_out.validate_amount(fee_amount)?,
    );

    let lending_params = pre_lock_arguments.lending_params();

    let first_nft_parameters = FirstNFTParameters::decode(first_parameters_nft_value);
    let second_nft_parameters = SecondNFTParameters::decode(second_parameters_nft_value);

    lending_params.validate_params(&first_nft_parameters, &second_nft_parameters)?;

    check_asset_id(pre_lock_asset_id, pre_lock_arguments.collateral_asset_id())?;
    check_asset_id(
        first_parameters_nft_asset_id,
        pre_lock_arguments.first_parameters_nft_asset_id(),
    )?;
    check_asset_id(
        second_parameters_nft_asset_id,
        pre_lock_arguments.second_parameters_nft_asset_id(),
    )?;
    check_asset_id(
        borrower_nft_asset_id,
        pre_lock_arguments.borrower_nft_asset_id(),
    )?;
    check_asset_id(
        lender_nft_asset_id,
        pre_lock_arguments.lender_nft_asset_id(),
    )?;

    check_asset_value(pre_lock_value, lending_params.collateral_amount)?;

    check_asset_value(borrower_nft_value, 1)?;
    check_asset_value(lender_nft_value, 1)?;

    let change_recipient_script = fee_tx_out.script_pubkey.clone();

    let mut pst = PartiallySignedTransaction::new_v2();

    // Inputs setup

    // Add Pre Lock input
    add_base_input_from_utxo(&mut pst, pre_lock_out_point, pre_lock_tx_out, None);

    // Add First Parameters NFT input
    add_base_input_from_utxo(
        &mut pst,
        first_parameters_nft_out_point,
        first_parameters_nft_tx_out,
        None,
    );

    // Add Second Parameters NFT input
    add_base_input_from_utxo(
        &mut pst,
        second_parameters_nft_out_point,
        second_parameters_nft_tx_out,
        None,
    );

    // Add Borrower NFT input
    add_base_input_from_utxo(&mut pst, borrower_nft_out_point, borrower_nft_tx_out, None);

    // Add Lender NFT input
    add_base_input_from_utxo(&mut pst, lender_nft_out_point, lender_nft_tx_out, None);

    // Add Fee input
    add_base_input_from_utxo(&mut pst, fee_out_point, fee_tx_out, None);

    // Outputs setup

    let is_lbtc_change_needed = total_lbtc_left != 0;

    // Add Collateral asset output
    pst.add_output(Output::new_explicit(
        collateral_output_script.clone(),
        pre_lock_value,
        pre_lock_asset_id,
        None,
    ));

    // Add First Parameters NFT output
    pst.add_output(Output::new_explicit(
        Script::new_op_return(b"burn"),
        first_parameters_nft_value,
        first_parameters_nft_asset_id,
        None,
    ));

    // Add Second Parameters NFT output
    pst.add_output(Output::new_explicit(
        Script::new_op_return(b"burn"),
        second_parameters_nft_value,
        second_parameters_nft_asset_id,
        None,
    ));

    // Add Borrower NFT output
    pst.add_output(Output::new_explicit(
        Script::new_op_return(b"burn"),
        borrower_nft_value,
        borrower_nft_asset_id,
        None,
    ));

    // Add Lender NFT output
    pst.add_output(Output::new_explicit(
        Script::new_op_return(b"burn"),
        lender_nft_value,
        lender_nft_asset_id,
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
