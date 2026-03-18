use simplex::{
    provider::SimplicityNetwork,
    transaction::{FinalTransaction, PartialInput, PartialOutput, RequiredSignature},
};
use simplex::simplicityhl::elements::{AssetId, OutPoint, TxOut, hashes::sha256};
use simplicityhl::elements::Script;

use crate::{
    artifacts::{
        asset_auth::derived_asset_auth::AssetAuthArguments,
        script_auth::derived_script_auth::ScriptAuthArguments,
    },
    programs::{AssetAuth, Lending, LendingBranch, ScriptAuth, program::SimplexProgram},
    transactions::lending::LendingTransactionError,
    utils::calculate_principal_with_interest,
};

pub fn repay_loan(
    lending_utxo: (OutPoint, TxOut),
    first_parameters_nft_utxo: (OutPoint, TxOut),
    second_parameters_nft_utxo: (OutPoint, TxOut),
    borrower_nft_input: (PartialInput, RequiredSignature),
    principal_inputs: Vec<(PartialInput, RequiredSignature)>,
    collateral_output: PartialOutput,
    lending: Lending,
    network: SimplicityNetwork,
) -> Result<FinalTransaction, LendingTransactionError> {
    let mut ft = FinalTransaction::new(network);

    let (first_parameters_nft_asset_id, first_parameters_nft_amount) = (
        first_parameters_nft_utxo.1.asset.explicit().unwrap(),
        first_parameters_nft_utxo.1.value.explicit().unwrap(),
    );
    let (second_parameters_nft_asset_id, second_parameters_nft_amount) = (
        second_parameters_nft_utxo.1.asset.explicit().unwrap(),
        second_parameters_nft_utxo.1.value.explicit().unwrap(),
    );
    let borrower_nft_asset_id = borrower_nft_input.0.asset.unwrap();

    let witness = Lending::get_lending_witness(&LendingBranch::LoanRepayment);

    lending.add_program_input(&mut ft, lending_utxo, Box::new(witness))?;

    let lending_cov_hash = lending.get_script_hash()?;
    let parameters_script_auth = ScriptAuth::new(
        ScriptAuthArguments {
            script_hash: lending_cov_hash,
        },
        network,
    );
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

    let (borrower_nft_partial_input, required_sig) = borrower_nft_input;

    ft.add_input(borrower_nft_partial_input, required_sig)?;

    for (principal_input, required_sig) in principal_inputs {
        ft.add_input(principal_input, required_sig)?;
    }

    let lending_arguments = lending.get_lending_arguments();
    let lender_principal_asset_auth = AssetAuth::new(
        AssetAuthArguments {
            asset_id: lending_arguments.lender_nft_asset_id,
            asset_amount: 1,
            with_asset_burn: true,
        },
        network,
    );

    ft.add_output(collateral_output);

    let principal_with_interest = calculate_principal_with_interest(
        lending_arguments.principal_amount,
        lending_arguments.principal_interest_rate,
    );
    let principal_asset_id =
        AssetId::from_inner(sha256::Midstate(lending_arguments.principal_asset_id));

    lender_principal_asset_auth.add_program_output(
        &mut ft,
        principal_asset_id,
        principal_with_interest,
    )?;

    ft.add_output(PartialOutput::new(
        Script::new_op_return(b"burn"),
        first_parameters_nft_amount,
        first_parameters_nft_asset_id,
    ));

    ft.add_output(PartialOutput::new(
        Script::new_op_return(b"burn"),
        second_parameters_nft_amount,
        second_parameters_nft_asset_id,
    ));

    ft.add_output(PartialOutput::new(
        Script::new_op_return(b"burn"),
        1,
        borrower_nft_asset_id,
    ));

    Ok(ft)
}
