use simplex::{
    simplicityhl::elements::{LockTime, Script, Sequence},
    transaction::{FinalTransaction, PartialInput, PartialOutput, UTXO},
};

use crate::{
    programs::{Lending, LendingBranch, ScriptAuth, program::SimplexProgram},
    transactions::{core::SimplexInput, lending::LendingTransactionError},
};

pub fn liquidate_loan(
    lending_utxo: UTXO,
    first_parameters_nft_utxo: UTXO,
    second_parameters_nft_utxo: UTXO,
    lender_nft_input: &SimplexInput,
    collateral_output: PartialOutput,
    lending: Lending,
) -> Result<FinalTransaction, LendingTransactionError> {
    let lending_parameters = lending.get_lending_parameters();
    let mut ft = FinalTransaction::new();

    let first_parameters_nft_amount = first_parameters_nft_utxo.txout.value.explicit().unwrap();
    let second_parameters_nft_amount = second_parameters_nft_utxo.txout.value.explicit().unwrap();

    let witness = Lending::get_lending_witness(&LendingBranch::LoanLiquidation);

    let locktime = LockTime::from_height(lending_parameters.offer_parameters.loan_expiration_time)
        .map_err(|_| {
            LendingTransactionError::InvalidLockHeight(
                lending_parameters.offer_parameters.loan_expiration_time,
            )
        })?;

    let lending_input = PartialInput::new(lending_utxo)
        .with_sequence(Sequence::ENABLE_LOCKTIME_NO_RBF)
        .with_locktime(locktime);

    lending.add_program_input_from_partial_input(&mut ft, lending_input, Box::new(witness))?;

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
