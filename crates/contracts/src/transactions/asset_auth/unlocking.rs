use simplex::simplex_sdk::{
    provider::SimplicityNetwork,
    transaction::{FinalTransaction, PartialInput, PartialOutput, RequiredSignature},
};
use simplicityhl::elements::{OutPoint, Script, TxOut};

use crate::{
    programs::{AssetAuth, AssetAuthWitnessParams, program::SimplexProgram},
    transactions::asset_auth::AssetAuthTransactionError,
};

pub fn unlock_asset_auth(
    program_utxo: (OutPoint, TxOut),
    auth_input: (PartialInput, RequiredSignature),
    unlocked_output: PartialOutput,
    asset_auth: AssetAuth,
    network: SimplicityNetwork,
) -> Result<FinalTransaction, AssetAuthTransactionError> {
    let mut ft = FinalTransaction::new(network);

    let witness_params = AssetAuthWitnessParams {
        input_asset_index: 1,
        output_asset_index: 1,
    };
    let witness = AssetAuth::get_asset_auth_witness(&witness_params);

    asset_auth.add_program_input(&mut ft, program_utxo, Box::new(witness))?;

    let (partial_auth_input, required_sig) = auth_input;

    let auth_output_asset = partial_auth_input.asset.unwrap();
    let auth_output_amount = partial_auth_input.amount.unwrap();
    let mut auth_output_script = partial_auth_input.witness_utxo.script_pubkey.clone();

    ft.add_input(partial_auth_input, required_sig)?;

    ft.add_output(unlocked_output);

    let arguments = asset_auth.get_asset_auth_arguments();

    if arguments.with_asset_burn {
        auth_output_script = Script::new_op_return(b"burn");
    }

    ft.add_output(PartialOutput::new(
        auth_output_script,
        auth_output_amount,
        auth_output_asset,
    ));

    Ok(ft)
}
