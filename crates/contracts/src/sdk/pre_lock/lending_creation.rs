use simplicity_contracts::sdk::validation::TxOutExt;

use simplicityhl::elements::hashes::Hash;
use simplicityhl::elements::pset::{Output, PartiallySignedTransaction};
use simplicityhl::elements::{OutPoint, PubkeyHash, Script, TxOut};
use simplicityhl_core::{SimplicityNetwork, hash_script};

use crate::asset_auth::build_arguments::AssetAuthArguments;
use crate::asset_auth::get_asset_auth_address;
use crate::error::TransactionBuildError;
use crate::lending::build_arguments::LendingArguments;
use crate::lending::get_lending_address;
use crate::pre_lock::build_arguments::PreLockArguments;
use crate::script_auth::build_arguments::ScriptAuthArguments;
use crate::script_auth::get_script_auth_address;
use crate::sdk::basic::{add_base_input_from_utxo, check_asset_id, check_asset_value};
use crate::sdk::parameters::{FirstNFTParameters, SecondNFTParameters};
use crate::sdk::{check_script, taproot_unspendable_internal_key};

/// Create a lending covenant UTXO by spending pre lock UTXO
///
/// # Errors
///
/// Returns an error if:
/// - The UTXO values are not explicit
/// - The fee UTXO does not have enough fee value
/// - The taproot pubkey generation fails
/// - The parameters NFT values validation fails
/// - Passed UTXOs asset ids and values differ from the arguments
///
/// # Panics
///
/// - if getting the asset auth covenant address fails
/// - if getting the script auth covenant address fails
/// - if getting the lending covenant address fails
#[allow(clippy::too_many_arguments)]
#[allow(clippy::too_many_lines)]
pub fn build_pre_lock_lending_creation(
    pre_lock_utxo: (OutPoint, TxOut),
    principal_utxo: (OutPoint, TxOut),
    first_parameters_nft_utxo: (OutPoint, TxOut),
    second_parameters_nft_utxo: (OutPoint, TxOut),
    borrower_nft_utxo: (OutPoint, TxOut),
    lender_nft_utxo: (OutPoint, TxOut),
    fee_utxo: (OutPoint, TxOut),
    pre_lock_arguments: &PreLockArguments,
    lender_nft_output_script: &Script,
    fee_amount: u64,
    network: SimplicityNetwork,
) -> Result<PartiallySignedTransaction, TransactionBuildError> {
    let (pre_lock_out_point, pre_lock_tx_out) = pre_lock_utxo;
    let (principal_out_point, principal_tx_out) = principal_utxo;
    let (first_parameters_nft_out_point, first_parameters_nft_tx_out) = first_parameters_nft_utxo;
    let (second_parameters_nft_out_point, second_parameters_nft_tx_out) =
        second_parameters_nft_utxo;
    let (borrower_nft_out_point, borrower_nft_tx_out) = borrower_nft_utxo;
    let (lender_nft_out_point, lender_nft_tx_out) = lender_nft_utxo;
    let (fee_out_point, fee_tx_out) = fee_utxo;

    let (pre_lock_asset_id, pre_lock_value) = pre_lock_tx_out.explicit()?;
    let (principal_asset_id, principal_value) = principal_tx_out.explicit()?;
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

    // Calculate script hash for the AssetAuth covenant with the Lender NFT auth
    let asset_auth_arguments = AssetAuthArguments {
        asset_id: lender_nft_asset_id.into_inner().0,
        asset_amount: 1,
        with_asset_burn: true,
    };
    let lender_principal_script = get_asset_auth_address(
        &taproot_unspendable_internal_key(),
        &asset_auth_arguments,
        network,
    )
    .unwrap()
    .script_pubkey();
    let principal_auth_script_hash = hash_script(&lender_principal_script);

    // Calculate Lending covenant script hash
    let lending_arguments = LendingArguments::new(
        pre_lock_asset_id.into_inner().0,
        principal_asset_id.into_inner().0,
        borrower_nft_asset_id.into_inner().0,
        lender_nft_asset_id.into_inner().0,
        first_parameters_nft_asset_id.into_inner().0,
        second_parameters_nft_asset_id.into_inner().0,
        principal_auth_script_hash,
        &lending_params,
    );
    let lending_script = get_lending_address(
        &taproot_unspendable_internal_key(),
        &lending_arguments,
        network,
    )
    .unwrap()
    .script_pubkey();
    let lending_cov_hash = hash_script(&lending_script);

    // Calculate ScriptAuth covenant script for the parameters nft
    let script_auth_arguments = ScriptAuthArguments::new(lending_cov_hash);
    let script_auth_script = get_script_auth_address(
        &taproot_unspendable_internal_key(),
        &script_auth_arguments,
        network,
    )
    .unwrap()
    .script_pubkey();

    // Calculate P2PKH script with the borrower public key
    let borrower_p2pkh_script =
        Script::new_p2pkh(&PubkeyHash::hash(&pre_lock_arguments.borrower_pub_key()));

    check_asset_id(pre_lock_asset_id, pre_lock_arguments.collateral_asset_id())?;
    check_asset_id(principal_asset_id, pre_lock_arguments.principal_asset_id())?;
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
    check_asset_value(principal_value, lending_params.principal_amount)?;

    check_asset_value(borrower_nft_value, 1)?;
    check_asset_value(lender_nft_value, 1)?;

    check_script(&lending_script, pre_lock_arguments.lending_cov_hash())?;
    check_script(
        &borrower_p2pkh_script,
        pre_lock_arguments.principal_output_script_hash(),
    )?;
    check_script(
        &borrower_p2pkh_script,
        pre_lock_arguments.borrower_nft_output_script_hash(),
    )?;
    check_script(
        &script_auth_script,
        pre_lock_arguments.parameters_nft_output_script_hash(),
    )?;

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

    // Add Principal input
    add_base_input_from_utxo(&mut pst, principal_out_point, principal_tx_out, None);

    // Add Fee input
    add_base_input_from_utxo(&mut pst, fee_out_point, fee_tx_out, None);

    // Outputs setup

    let is_lbtc_change_needed = total_lbtc_left != 0;

    // Add Collateral asset output
    pst.add_output(Output::new_explicit(
        lending_script,
        pre_lock_value,
        pre_lock_asset_id,
        None,
    ));

    // Add Principal output
    pst.add_output(Output::new_explicit(
        borrower_p2pkh_script.clone(),
        principal_value,
        principal_asset_id,
        None,
    ));

    // Add First Parameters NFT output
    pst.add_output(Output::new_explicit(
        script_auth_script.clone(),
        first_parameters_nft_value,
        first_parameters_nft_asset_id,
        None,
    ));

    // Add Second Parameters NFT output
    pst.add_output(Output::new_explicit(
        script_auth_script,
        second_parameters_nft_value,
        second_parameters_nft_asset_id,
        None,
    ));

    // Add Borrower NFT output
    pst.add_output(Output::new_explicit(
        borrower_p2pkh_script,
        borrower_nft_value,
        borrower_nft_asset_id,
        None,
    ));

    // Add Lender NFT output
    pst.add_output(Output::new_explicit(
        lender_nft_output_script.clone(),
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
