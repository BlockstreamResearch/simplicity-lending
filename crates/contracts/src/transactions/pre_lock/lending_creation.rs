use simplex::simplicityhl::elements::{OutPoint, Script, TxOut};
use simplex::transaction::{FinalTransaction, PartialOutput};

use crate::transactions::core::SimplexInput;
use crate::{
    programs::{Lending, PreLock, PreLockBranch, ScriptAuth, program::SimplexProgram},
    transactions::pre_lock::PreLockTransactionError,
};

#[allow(clippy::too_many_arguments)]
pub fn create_lending_from_pre_lock(
    pre_lock_utxo: (OutPoint, TxOut),
    first_parameters_nft_utxo: (OutPoint, TxOut),
    second_parameters_nft_utxo: (OutPoint, TxOut),
    borrower_nft_utxo: (OutPoint, TxOut),
    lender_nft_utxo: (OutPoint, TxOut),
    principal_inputs: Vec<&SimplexInput>,
    lender_nft_output: PartialOutput,
    borrower_output_script: Script,
    pre_lock: PreLock,
) -> Result<(FinalTransaction, Lending), PreLockTransactionError> {
    let pre_lock_parameters = pre_lock.get_pre_lock_parameters();
    let mut ft = FinalTransaction::new(pre_lock_parameters.network);

    let first_parameters_nft_amount = first_parameters_nft_utxo.1.value.explicit().unwrap();
    let second_parameters_nft_amount = second_parameters_nft_utxo.1.value.explicit().unwrap();

    let pre_lock_witness = PreLock::get_pre_lock_witness(&PreLockBranch::LendingCreation);
    pre_lock.add_program_input(&mut ft, pre_lock_utxo, Box::new(pre_lock_witness))?;

    let utility_nfts_script_auth = ScriptAuth::from_simplex_program(&pre_lock)?;
    let utility_nfts_witness = ScriptAuth::get_script_auth_witness(0);

    utility_nfts_script_auth.add_program_input(
        &mut ft,
        first_parameters_nft_utxo,
        Box::new(utility_nfts_witness.clone()),
    )?;
    utility_nfts_script_auth.add_program_input(
        &mut ft,
        second_parameters_nft_utxo,
        Box::new(utility_nfts_witness.clone()),
    )?;
    utility_nfts_script_auth.add_program_input(
        &mut ft,
        borrower_nft_utxo,
        Box::new(utility_nfts_witness.clone()),
    )?;
    utility_nfts_script_auth.add_program_input(
        &mut ft,
        lender_nft_utxo,
        Box::new(utility_nfts_witness.clone()),
    )?;

    for principal_input in principal_inputs {
        ft.add_input(
            principal_input.partial_input().clone(),
            principal_input.required_sig().clone(),
        )?;
    }

    let lending = Lending::new(pre_lock_parameters.into())?;
    let parameter_nfts_script_auth = pre_lock_parameters.get_parameter_nfts_script_auth()?;

    lending.add_program_output(
        &mut ft,
        pre_lock_parameters.collateral_asset_id,
        pre_lock_parameters.offer_parameters.collateral_amount,
    )?;

    ft.add_output(PartialOutput::new(
        borrower_output_script.clone(),
        pre_lock_parameters.offer_parameters.principal_amount,
        pre_lock_parameters.principal_asset_id,
    ));

    parameter_nfts_script_auth.add_program_output(
        &mut ft,
        pre_lock_parameters.first_parameters_nft_asset_id,
        first_parameters_nft_amount,
    )?;
    parameter_nfts_script_auth.add_program_output(
        &mut ft,
        pre_lock_parameters.second_parameters_nft_asset_id,
        second_parameters_nft_amount,
    )?;

    ft.add_output(PartialOutput::new(
        borrower_output_script,
        1,
        pre_lock_parameters.borrower_nft_asset_id,
    ));
    ft.add_output(lender_nft_output);

    Ok((ft, lending))
}
