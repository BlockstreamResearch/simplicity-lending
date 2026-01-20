use simplicity_contracts::sdk::taproot_pubkey_gen::TaprootPubkeyGen;

use simplicity_contracts::sdk::validation::TxOutExt;

use simplicityhl::elements::pset::{Input, Output, PartiallySignedTransaction};
use simplicityhl::elements::{AddressParams, OutPoint, Script, Sequence, TxOut};

use crate::asset_auth::{build_arguments::AssetAuthArguments, get_asset_auth_address};
use crate::error::TransactionBuildError;

/// Create a new asset auth contract.
///
/// # Errors
///
/// Returns an error if:
/// - The UTXO values are not explicit
/// - The fee UTXO does not have enough fee value
/// - The taproot pubkey generation fails
pub fn build_asset_auth_creation(
    utxo_to_lock: (OutPoint, TxOut),
    fee_utxo: (OutPoint, TxOut),
    asset_auth_arguments: &AssetAuthArguments,
    fee_amount: u64,
    address_params: &'static AddressParams,
) -> Result<(PartiallySignedTransaction, TaprootPubkeyGen), TransactionBuildError> {
    let (lock_out_point, lock_tx_out) = utxo_to_lock;
    let (fee_out_point, fee_tx_out) = fee_utxo;

    let (lock_asset_id, lock_value) = lock_tx_out.explicit()?;
    let (fee_asset_id, total_lbtc_left) = (
        fee_tx_out.explicit_asset()?,
        fee_tx_out.validate_amount(fee_amount)?,
    );

    let change_recipient_script = fee_tx_out.script_pubkey.clone();

    let asset_auth_taproot_pubkey_gen = TaprootPubkeyGen::from(
        asset_auth_arguments,
        address_params,
        &get_asset_auth_address,
    )?;

    let mut pst = PartiallySignedTransaction::new_v2();

    let mut lock_input = Input::from_prevout(lock_out_point);
    lock_input.witness_utxo = Some(lock_tx_out.clone());
    lock_input.sequence = Some(Sequence::ENABLE_LOCKTIME_NO_RBF);
    pst.add_input(lock_input);

    let mut fee_input = Input::from_prevout(fee_out_point);
    fee_input.witness_utxo = Some(fee_tx_out.clone());
    fee_input.sequence = Some(Sequence::ENABLE_LOCKTIME_NO_RBF);
    pst.add_input(fee_input);

    let is_lbtc_change_needed = total_lbtc_left != 0;

    pst.add_output(Output::new_explicit(
        asset_auth_taproot_pubkey_gen.address.script_pubkey(),
        lock_value,
        lock_asset_id,
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

    Ok((pst, asset_auth_taproot_pubkey_gen))
}

/// Create a new asset auth script.
///
/// # Errors
///
/// Returns an error if the taproot pubkey generation fails
pub fn generate_asset_auth_script(
    asset_auth_arguments: &AssetAuthArguments,
    address_params: &'static AddressParams,
) -> Result<Script, TransactionBuildError> {
    let asset_auth_taproot_pubkey_gen = TaprootPubkeyGen::from(
        asset_auth_arguments,
        address_params,
        &get_asset_auth_address,
    )?;

    Ok(asset_auth_taproot_pubkey_gen.address.script_pubkey())
}
