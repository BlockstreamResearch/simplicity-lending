use simplex::simplicityhl::elements::Script;
use simplex::transaction::{FinalTransaction, PartialOutput, UTXO};

use crate::transactions::core::SimplexInput;
use crate::{
    programs::{Lending, LendingBranch, ScriptAuth, program::SimplexProgram},
    transactions::lending::LendingTransactionError,
};

pub fn repay_loan(
    lending_utxo: UTXO,
    first_parameters_nft_utxo: UTXO,
    second_parameters_nft_utxo: UTXO,
    borrower_nft_input: &SimplexInput,
    principal_inputs: Vec<SimplexInput>,
    collateral_output: PartialOutput,
    lending: Lending,
) -> Result<FinalTransaction, LendingTransactionError> {
    let lending_parameters = lending.get_lending_parameters();
    let mut ft = FinalTransaction::new();

    let first_parameters_nft_amount = first_parameters_nft_utxo.explicit_amount();
    let second_parameters_nft_amount = second_parameters_nft_utxo.explicit_amount();

    let witness = Lending::get_lending_witness(&LendingBranch::LoanRepayment);

    lending.add_program_input(&mut ft, lending_utxo, Box::new(witness));

    let parameters_script_auth = ScriptAuth::from_simplex_program(&lending);
    let parameters_witness = ScriptAuth::get_script_auth_witness(0);

    parameters_script_auth.add_program_input(
        &mut ft,
        first_parameters_nft_utxo,
        Box::new(parameters_witness.clone()),
    );
    parameters_script_auth.add_program_input(
        &mut ft,
        second_parameters_nft_utxo,
        Box::new(parameters_witness),
    );

    ft.add_input(
        borrower_nft_input.partial_input().clone(),
        borrower_nft_input.required_sig().clone(),
    );

    let mut total_principal_input_amount = 0;
    let principal_script_pubkey = principal_inputs.first().unwrap().utxo_script_pubkey();

    for principal_input in principal_inputs {
        ft.add_input(
            principal_input.partial_input().clone(),
            principal_input.required_sig().clone(),
        );

        total_principal_input_amount += principal_input.explicit_amount();
    }

    ft.add_output(collateral_output);

    let principal_with_interest = lending_parameters
        .offer_parameters
        .calculate_principal_with_interest();
    let lender_principal_asset_auth = lending_parameters.get_lender_principal_asset_auth();

    if total_principal_input_amount < principal_with_interest {
        return Err(LendingTransactionError::NotEnoughPrincipalToRepay {
            expected: principal_with_interest,
            actual: total_principal_input_amount,
        });
    }

    lender_principal_asset_auth.add_program_output(
        &mut ft,
        lending_parameters.principal_asset_id,
        principal_with_interest,
    );

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
        lending_parameters.borrower_nft_asset_id,
    ));

    if total_principal_input_amount > principal_with_interest {
        ft.add_output(PartialOutput::new(
            principal_script_pubkey,
            total_principal_input_amount - principal_with_interest,
            lending_parameters.principal_asset_id,
        ));
    }

    Ok(ft)
}
