use simplex::transaction::{FinalTransaction, PartialOutput, UTXO};

use crate::{
    programs::{AssetAuth, AssetAuthWitnessParams, program::SimplexProgram},
    transactions::core::SimplexInput,
};

pub fn unlock_asset_auth(
    program_utxo: UTXO,
    auth_input: &SimplexInput,
    unlocked_output: PartialOutput,
    asset_auth: AssetAuth,
) -> FinalTransaction {
    let parameters = asset_auth.get_asset_auth_parameters();

    let mut ft = FinalTransaction::new();

    let witness_params = AssetAuthWitnessParams {
        input_asset_index: 1,
        output_asset_index: 1,
    };
    let witness = AssetAuth::get_asset_auth_witness(&witness_params);

    asset_auth.add_program_input(&mut ft, program_utxo, Box::new(witness));

    ft.add_input(
        auth_input.partial_input().clone(),
        auth_input.required_sig().clone(),
    );

    ft.add_output(unlocked_output);

    if parameters.with_asset_burn {
        ft.add_output(auth_input.new_burn_partial_output());
    } else {
        ft.add_output(auth_input.new_partial_output());
    }

    ft
}
