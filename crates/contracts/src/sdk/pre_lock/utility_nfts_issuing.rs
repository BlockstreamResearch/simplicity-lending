use simplicity_contracts::sdk::validation::TxOutExt;

use crate::error::TransactionBuildError;
use crate::sdk::basic::{add_base_input_from_utxo, add_nft_issuance_input_from_utxo};
use crate::sdk::parameters::LendingParameters;
use simplicityhl::elements::pset::{Output, PartiallySignedTransaction};
use simplicityhl::elements::{OutPoint, Script, TxOut};

/// Create a Utility NFTs issuing transaction
///
/// # Errors
///
/// Returns an error if:
/// - The UTXO values are not explicit
/// - The fee UTXO does not have enough fee value
/// - The parameters NFT amounts encoding fails
#[allow(clippy::too_many_arguments)]
#[allow(clippy::too_many_lines)]
pub fn build_utility_nfts_issuing(
    first_issuance_utxo: (OutPoint, TxOut),
    second_issuance_utxo: (OutPoint, TxOut),
    third_issuance_utxo: (OutPoint, TxOut),
    fourth_issuance_utxo: (OutPoint, TxOut),
    fee_utxo: (OutPoint, TxOut),
    lending_params: &LendingParameters,
    tokens_decimals: u8,
    issuance_asset_entropy: [u8; 32],
    utility_nfts_output_script: &Script,
    fee_amount: u64,
) -> Result<PartiallySignedTransaction, TransactionBuildError> {
    let (first_out_point, first_tx_out) = first_issuance_utxo;
    let (second_out_point, second_tx_out) = second_issuance_utxo;
    let (third_out_point, third_tx_out) = third_issuance_utxo;
    let (fourth_out_point, fourth_tx_out) = fourth_issuance_utxo;
    let (fee_out_point, fee_tx_out) = fee_utxo;

    let (first_asset_id, first_value) = first_tx_out.explicit()?;
    let (second_asset_id, second_value) = second_tx_out.explicit()?;
    let (third_asset_id, third_value) = third_tx_out.explicit()?;
    let (fourth_asset_id, fourth_value) = fourth_tx_out.explicit()?;
    let (fee_asset_id, total_lbtc_left) = (
        fee_tx_out.explicit_asset()?,
        fee_tx_out.validate_amount(fee_amount)?,
    );

    let first_issuance_utxo_script = first_tx_out.script_pubkey.clone();
    let second_issuance_utxo_script = second_tx_out.script_pubkey.clone();
    let third_issuance_utxo_script = third_tx_out.script_pubkey.clone();
    let fourth_issuance_utxo_script = fourth_tx_out.script_pubkey.clone();
    let change_recipient_script = fee_tx_out.script_pubkey.clone();

    let (first_parameters_nft_amount, second_parameters_nft_amount) =
        lending_params.encode_parameters_nft_amounts(tokens_decimals)?;

    let mut pst = PartiallySignedTransaction::new_v2();

    // Inputs setup

    // Add Borrower NFT issuance input
    let borrower_nft_asset_id = add_nft_issuance_input_from_utxo(
        &mut pst,
        first_out_point,
        first_tx_out,
        1,
        issuance_asset_entropy,
    );

    // Add Lender NFT issuance input
    let lender_nft_asset_id = add_nft_issuance_input_from_utxo(
        &mut pst,
        second_out_point,
        second_tx_out,
        1,
        issuance_asset_entropy,
    );

    // Add First Parameters NFT issuance input
    let first_parameters_nft_asset_id = add_nft_issuance_input_from_utxo(
        &mut pst,
        third_out_point,
        third_tx_out,
        first_parameters_nft_amount,
        issuance_asset_entropy,
    );

    // Add Second Parameters NFT issuance input
    let second_parameters_nft_asset_id = add_nft_issuance_input_from_utxo(
        &mut pst,
        fourth_out_point,
        fourth_tx_out,
        second_parameters_nft_amount,
        issuance_asset_entropy,
    );

    // Add Fee input
    add_base_input_from_utxo(&mut pst, fee_out_point, fee_tx_out, None);

    // Outputs setup

    let is_lbtc_change_needed = total_lbtc_left != 0;

    // Add Borrower NFT output
    pst.add_output(Output::new_explicit(
        utility_nfts_output_script.clone(),
        1,
        borrower_nft_asset_id,
        None,
    ));

    // Add Lender NFT output
    pst.add_output(Output::new_explicit(
        utility_nfts_output_script.clone(),
        1,
        lender_nft_asset_id,
        None,
    ));

    // Add First Parameters NFT output
    pst.add_output(Output::new_explicit(
        utility_nfts_output_script.clone(),
        first_parameters_nft_amount,
        first_parameters_nft_asset_id,
        None,
    ));

    // Add Second Parameters NFT output
    pst.add_output(Output::new_explicit(
        utility_nfts_output_script.clone(),
        second_parameters_nft_amount,
        second_parameters_nft_asset_id,
        None,
    ));

    // Return Inputs assets back

    // Return first issuance UTXO back
    pst.add_output(Output::new_explicit(
        first_issuance_utxo_script,
        first_value,
        first_asset_id,
        None,
    ));

    // Return second issuance UTXO back
    pst.add_output(Output::new_explicit(
        second_issuance_utxo_script,
        second_value,
        second_asset_id,
        None,
    ));

    // Return third issuance UTXO back
    pst.add_output(Output::new_explicit(
        third_issuance_utxo_script,
        third_value,
        third_asset_id,
        None,
    ));

    // Return fourth issuance UTXO back
    pst.add_output(Output::new_explicit(
        fourth_issuance_utxo_script,
        fourth_value,
        fourth_asset_id,
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
