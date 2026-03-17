use simplex::simplex_sdk::{
    provider::SimplicityNetwork,
    transaction::{FinalTransaction, PartialInput, RequiredSignature},
};

use crate::{
    artifacts::script_auth::derived_script_auth::ScriptAuthArguments,
    programs::{ScriptAuth, program::SimplexProgram},
    transactions::script_auth::ScriptAuthTransactionError,
};

pub fn create_script_auth(
    input_to_lock: (PartialInput, RequiredSignature),
    network: SimplicityNetwork,
    arguments: ScriptAuthArguments,
) -> Result<(FinalTransaction, ScriptAuth), ScriptAuthTransactionError> {
    let amount_to_lock = input_to_lock
        .0
        .amount
        .ok_or(ScriptAuthTransactionError::InvalidAssetAmount())?;

    create_script_auth_with_amount(input_to_lock, amount_to_lock, network, arguments)
}

pub fn create_script_auth_with_amount(
    input_to_lock: (PartialInput, RequiredSignature),
    amount_to_lock: u64,
    network: SimplicityNetwork,
    arguments: ScriptAuthArguments,
) -> Result<(FinalTransaction, ScriptAuth), ScriptAuthTransactionError> {
    let script_auth = ScriptAuth::new(arguments, network.clone());
    let mut ft = FinalTransaction::new(network);

    let (partial_input_to_lock, required_sig) = input_to_lock;

    let asset_id_to_lock = partial_input_to_lock
        .asset
        .ok_or(ScriptAuthTransactionError::InvalidAssetId())?;

    ft.add_input(partial_input_to_lock, required_sig)?;

    script_auth.add_program_output(&mut ft, asset_id_to_lock, amount_to_lock)?;

    Ok((ft, script_auth))
}
