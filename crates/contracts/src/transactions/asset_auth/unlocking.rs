use simplex::transaction::{FinalTransaction, PartialOutput};
use simplicityhl::elements::{OutPoint, TxOut};

use crate::{
    programs::{AssetAuth, AssetAuthWitnessParams, program::SimplexProgram},
    transactions::{asset_auth::AssetAuthTransactionError, core::SimplexInput},
};

pub fn unlock_asset_auth(
    program_utxo: (OutPoint, TxOut),
    auth_input: &SimplexInput,
    unlocked_output: PartialOutput,
    asset_auth: AssetAuth,
) -> Result<FinalTransaction, AssetAuthTransactionError> {
    let parameters = asset_auth.get_asset_auth_parameters();

    let mut ft = FinalTransaction::new(parameters.network);

    let witness_params = AssetAuthWitnessParams {
        input_asset_index: 1,
        output_asset_index: 1,
    };
    let witness = AssetAuth::get_asset_auth_witness(&witness_params);

    asset_auth.add_program_input(&mut ft, program_utxo, Box::new(witness))?;

    ft.add_input(
        auth_input.partial_input().clone(),
        auth_input.required_sig().clone(),
    )?;

    ft.add_output(unlocked_output);

    if parameters.with_asset_burn {
        ft.add_output(auth_input.new_burn_partial_output());
    } else {
        ft.add_output(auth_input.new_partial_output());
    }

    Ok(ft)
}
