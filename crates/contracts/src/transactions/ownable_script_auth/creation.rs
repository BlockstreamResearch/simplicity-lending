use simplex::{
    simplicityhl::elements::{AssetId, Script},
    transaction::{FinalTransaction, PartialOutput},
};

use crate::{
    programs::{OwnableScriptAuth, OwnableScriptAuthParameters, program::SimplexProgram},
    transactions::core::SimplexInput,
};

pub fn create_ownable_script_auth(
    input_to_lock: &SimplexInput,
    amount_to_lock: u64,
    parameters: OwnableScriptAuthParameters,
) -> (FinalTransaction, OwnableScriptAuth) {
    let ownable_script_auth = OwnableScriptAuth::new(parameters);
    let mut ft = FinalTransaction::new();

    ft.add_input(
        input_to_lock.partial_input().clone(),
        input_to_lock.required_sig().clone(),
    );

    ownable_script_auth.add_program_output(&mut ft, input_to_lock.explicit_asset(), amount_to_lock);

    ft.add_output(PartialOutput::new(
        Script::new_op_return(parameters.owner_pubkey.serialize().as_slice()),
        0,
        AssetId::default(),
    ));

    (ft, ownable_script_auth)
}
