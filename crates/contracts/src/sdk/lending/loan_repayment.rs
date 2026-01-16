use simplicity_contracts::sdk::validation::TxOutExt;

use simplicityhl::elements::pset::{Output, PartiallySignedTransaction};
use simplicityhl::elements::{AddressParams, OutPoint, Script, TxOut};

use crate::asset_auth::build_arguments::AssetAuthArguments;
use crate::asset_auth::get_asset_auth_address;
use crate::error::TransactionBuildError;
use crate::lending::build_arguments::LendingArguments;
use crate::sdk::basic::{add_base_input_from_utxo, check_asset_id, check_asset_value};
use crate::sdk::parameters::{
    FirstNFTParameters, SecondNFTParameters, calculate_principal_with_interest,
};
use crate::sdk::taproot_unspendable_internal_key;

pub fn build_lending_loan_repayment(
    lending_utxo: (OutPoint, TxOut),
    principal_utxo: (OutPoint, TxOut),
    first_parameters_nft_utxo: (OutPoint, TxOut),
    second_parameters_nft_utxo: (OutPoint, TxOut),
    borrower_nft_utxo: (OutPoint, TxOut),
    fee_utxo: (OutPoint, TxOut),
    lending_arguments: &LendingArguments,
    collateral_output_script: &Script,
    fee_amount: u64,
    address_params: &'static AddressParams,
) -> Result<PartiallySignedTransaction, TransactionBuildError> {
    let (lending_out_point, lending_tx_out) = lending_utxo;
    let (principal_out_point, principal_tx_out) = principal_utxo;
    let (first_parameters_nft_out_point, first_parameters_nft_tx_out) = first_parameters_nft_utxo;
    let (second_parameters_nft_out_point, second_parameters_nft_tx_out) =
        second_parameters_nft_utxo;
    let (borrower_nft_out_point, borrower_nft_tx_out) = borrower_nft_utxo;
    let (fee_out_point, fee_tx_out) = fee_utxo;

    let (lending_asset_id, lending_value) = lending_tx_out.explicit()?;
    let (principal_asset_id, principal_value) = principal_tx_out.explicit()?;
    let (first_parameters_nft_asset_id, first_parameters_nft_value) =
        first_parameters_nft_tx_out.explicit()?;
    let (second_parameters_nft_asset_id, second_parameters_nft_value) =
        second_parameters_nft_tx_out.explicit()?;
    let (borrower_nft_asset_id, borrower_nft_value) = borrower_nft_tx_out.explicit()?;
    let (fee_asset_id, total_lbtc_left) = (
        fee_tx_out.explicit_asset()?,
        fee_tx_out.validate_amount(fee_amount)?,
    );

    let lending_params = lending_arguments.lending_params();

    let first_nft_parameters = FirstNFTParameters::decode(first_parameters_nft_value);
    let second_nft_parameters = SecondNFTParameters::decode(second_parameters_nft_value);

    lending_params.validate_params(&first_nft_parameters, &second_nft_parameters)?;

    check_asset_id(lending_asset_id, lending_arguments.collateral_asset_id())?;
    check_asset_id(principal_asset_id, lending_arguments.principal_asset_id())?;
    check_asset_id(
        first_parameters_nft_asset_id,
        lending_arguments.first_parameters_nft_asset_id(),
    )?;
    check_asset_id(
        second_parameters_nft_asset_id,
        lending_arguments.second_parameters_nft_asset_id(),
    )?;
    check_asset_id(
        borrower_nft_asset_id,
        lending_arguments.borrower_nft_asset_id(),
    )?;

    let principal_with_interest = calculate_principal_with_interest(
        lending_params.principal_amount,
        lending_params.principal_interest_rate,
    );

    check_asset_value(lending_value, lending_params.collateral_amount)?;
    check_asset_value(principal_value, principal_with_interest)?;

    check_asset_value(borrower_nft_value, 1)?;

    let change_recipient_script = fee_tx_out.script_pubkey.clone();

    let lender_principal_script = get_asset_auth_address(
        &taproot_unspendable_internal_key(),
        &AssetAuthArguments {
            asset_id: lending_arguments.lender_nft_asset_id(),
            asset_amount: 1,
            with_asset_burn: true,
        },
        address_params,
    )
    .unwrap()
    .script_pubkey();

    let mut pst = PartiallySignedTransaction::new_v2();

    // Inputs setup

    // Add Lending covenant input with the collateral asset
    add_base_input_from_utxo(&mut pst, lending_out_point, lending_tx_out, None);

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

    // Add Principal input
    add_base_input_from_utxo(&mut pst, principal_out_point, principal_tx_out, None);

    // Add Fee input
    add_base_input_from_utxo(&mut pst, fee_out_point, fee_tx_out, None);

    // Outputs setup

    let is_lbtc_change_needed = total_lbtc_left != 0;

    // Add Collateral asset output
    pst.add_output(Output::new_explicit(
        collateral_output_script.clone(),
        lending_value,
        lending_asset_id,
        None,
    ));

    // Add Principal asset output
    pst.add_output(Output::new_explicit(
        lender_principal_script,
        principal_value,
        principal_asset_id,
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
