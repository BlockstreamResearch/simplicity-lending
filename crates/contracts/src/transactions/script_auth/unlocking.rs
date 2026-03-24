use simplex::simplicityhl::elements::{OutPoint, TxOut};
use simplex::transaction::{FinalTransaction, PartialOutput};

use crate::{
    programs::{ScriptAuth, program::SimplexProgram},
    transactions::{core::SimplexInput, script_auth::ScriptAuthTransactionError},
};

pub fn unlock_script_auth(
    program_utxo: (OutPoint, TxOut),
    auth_input: &SimplexInput,
    unlocked_output: PartialOutput,
    script_auth: ScriptAuth,
) -> Result<FinalTransaction, ScriptAuthTransactionError> {
    let parameters = script_auth.get_script_auth_parameters();
    let mut ft = FinalTransaction::new(parameters.network);

    let witness = ScriptAuth::get_script_auth_witness(1);

    script_auth.add_program_input(&mut ft, program_utxo, Box::new(witness))?;

    ft.add_input(
        auth_input.partial_input().clone(),
        auth_input.required_sig().clone(),
    )?;

    ft.add_output(unlocked_output);

    Ok(ft)
}
