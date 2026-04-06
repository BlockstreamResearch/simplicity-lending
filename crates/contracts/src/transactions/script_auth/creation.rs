use simplex::transaction::FinalTransaction;

use crate::{
    programs::{ScriptAuth, ScriptAuthParameters, program::SimplexProgram},
    transactions::core::SimplexInput,
};

pub fn create_script_auth(
    input_to_lock: &SimplexInput,
    parameters: ScriptAuthParameters,
) -> (FinalTransaction, ScriptAuth) {
    let amount_to_lock = input_to_lock.explicit_amount();

    create_script_auth_with_amount(input_to_lock, amount_to_lock, parameters)
}

pub fn create_script_auth_with_amount(
    input_to_lock: &SimplexInput,
    amount_to_lock: u64,
    parameters: ScriptAuthParameters,
) -> (FinalTransaction, ScriptAuth) {
    let script_auth = ScriptAuth::new(parameters);
    let mut ft = FinalTransaction::new();

    ft.add_input(
        input_to_lock.partial_input().clone(),
        input_to_lock.required_sig().clone(),
    );

    script_auth.add_program_output(&mut ft, input_to_lock.explicit_asset(), amount_to_lock);

    (ft, script_auth)
}
