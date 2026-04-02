use simplex::transaction::{FinalTransaction, PartialOutput, UTXO};

use crate::{
    programs::{ScriptAuth, program::SimplexProgram},
    transactions::core::SimplexInput,
};

pub fn unlock_script_auth(
    program_utxo: UTXO,
    auth_input: &SimplexInput,
    unlocked_output: PartialOutput,
    script_auth: ScriptAuth,
) -> FinalTransaction {
    let mut ft = FinalTransaction::new();

    let witness = ScriptAuth::get_script_auth_witness(1);

    script_auth.add_program_input(&mut ft, program_utxo, Box::new(witness));

    ft.add_input(
        auth_input.partial_input().clone(),
        auth_input.required_sig().clone(),
    );

    ft.add_output(unlocked_output);

    ft
}
