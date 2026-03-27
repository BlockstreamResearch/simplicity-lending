use simplex::{
    simplicityhl::elements::{LockTime, OutPoint, Script, Sequence, TxOut},
    transaction::{FinalTransaction, PartialOutput},
};

use crate::{
    programs::{Lending, LendingBranch, ScriptAuth, program::SimplexProgram},
    transactions::{core::SimplexInput, lending::LendingTransactionError},
};

pub fn liquidate_loan(
    lending_utxo: (OutPoint, TxOut),
    first_parameters_nft_utxo: (OutPoint, TxOut),
    second_parameters_nft_utxo: (OutPoint, TxOut),
    lender_nft_input: &SimplexInput,
    collateral_output: PartialOutput,
    lending: Lending,
) -> Result<FinalTransaction, LendingTransactionError> {
    let lending_parameters = lending.get_lending_parameters();
    let mut ft = FinalTransaction::new(lending_parameters.network);

    let first_parameters_nft_amount = first_parameters_nft_utxo.1.value.explicit().unwrap();
    let second_parameters_nft_amount = second_parameters_nft_utxo.1.value.explicit().unwrap();

    let witness = Lending::get_lending_witness(&LendingBranch::LoanLiquidation);

    let locktime = LockTime::from_height(lending_parameters.offer_parameters.loan_expiration_time)
        .map_err(|_| {
            LendingTransactionError::InvalidLockHeight(
                lending_parameters.offer_parameters.loan_expiration_time,
            )
        })?;

    ft.set_fallback_locktime(Some(locktime));

    lending.add_program_input_with_sequence(
        &mut ft,
        lending_utxo,
        Box::new(witness),
        Sequence::ENABLE_LOCKTIME_NO_RBF,
    )?;

    let parameters_script_auth = ScriptAuth::from_simplex_program(&lending)?;
    let parameters_witness = ScriptAuth::get_script_auth_witness(0);

    parameters_script_auth.add_program_input(
        &mut ft,
        first_parameters_nft_utxo,
        Box::new(parameters_witness.clone()),
    )?;
    parameters_script_auth.add_program_input(
        &mut ft,
        second_parameters_nft_utxo,
        Box::new(parameters_witness),
    )?;

    ft.add_input(
        lender_nft_input.partial_input().clone(),
        lender_nft_input.required_sig().clone(),
    )?;

    ft.add_output(collateral_output);

    ft.add_output(PartialOutput::new(
        Script::new_op_return(b"burn"),
        first_parameters_nft_amount,
        lending_parameters.first_parameters_nft_asset_id,
    ));

    ft.add_output(PartialOutput::new(
        Script::new_op_return(b"burn"),
        second_parameters_nft_amount,
        lending_parameters.second_parameters_nft_asset_id,
    ));

    ft.add_output(PartialOutput::new(
        Script::new_op_return(b"burn"),
        1,
        lending_parameters.lender_nft_asset_id,
    ));

    Ok(ft)
}
