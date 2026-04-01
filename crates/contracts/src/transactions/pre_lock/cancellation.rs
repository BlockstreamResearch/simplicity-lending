use simplex::simplicityhl::elements::Script;
use simplex::transaction::{FinalTransaction, PartialOutput, UTXO};

use crate::{
    programs::{PreLock, PreLockBranch, ScriptAuth, program::SimplexProgram},
    transactions::pre_lock::PreLockTransactionError,
};

pub fn cancel_pre_lock(
    pre_lock_utxo: UTXO,
    first_parameters_nft_utxo: UTXO,
    second_parameters_nft_utxo: UTXO,
    borrower_nft_utxo: UTXO,
    lender_nft_utxo: UTXO,
    collateral_output: PartialOutput,
    pre_lock: PreLock,
) -> Result<FinalTransaction, PreLockTransactionError> {
    let pre_lock_parameters = pre_lock.get_pre_lock_parameters();
    let mut ft = FinalTransaction::new();

    let first_parameters_nft_amount = first_parameters_nft_utxo.txout.value.explicit().unwrap();
    let second_parameters_nft_amount = second_parameters_nft_utxo.txout.value.explicit().unwrap();

    let pre_lock_witness = PreLock::get_pre_lock_witness(&PreLockBranch::PreLockCancellation);
    pre_lock.add_program_input_with_signature(
        &mut ft,
        pre_lock_utxo,
        Box::new(pre_lock_witness),
        "SIGNATURE".into(),
    )?;

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

    ft.add_output(collateral_output);

    ft.add_output(PartialOutput::new(
        Script::new_op_return(b"burn"),
        first_parameters_nft_amount,
        pre_lock_parameters.first_parameters_nft_asset_id,
    ));

    ft.add_output(PartialOutput::new(
        Script::new_op_return(b"burn"),
        second_parameters_nft_amount,
        pre_lock_parameters.second_parameters_nft_asset_id,
    ));

    ft.add_output(PartialOutput::new(
        Script::new_op_return(b"burn"),
        1,
        pre_lock_parameters.borrower_nft_asset_id,
    ));

    ft.add_output(PartialOutput::new(
        Script::new_op_return(b"burn"),
        1,
        pre_lock_parameters.lender_nft_asset_id,
    ));

    Ok(ft)
}
