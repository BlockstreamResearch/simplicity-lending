use simplex::{
    provider::SimplicityNetwork,
    transaction::{FinalTransaction, PartialInput, PartialOutput, RequiredSignature},
};
use simplicityhl::elements::{OutPoint, TxOut};

use crate::{
    programs::{ScriptAuth, program::SimplexProgram},
    transactions::script_auth::ScriptAuthTransactionError,
};

pub fn unlock_script_auth(
    program_utxo: (OutPoint, TxOut),
    auth_input: (PartialInput, RequiredSignature),
    unlocked_output: PartialOutput,
    script_auth: ScriptAuth,
    network: SimplicityNetwork,
) -> Result<FinalTransaction, ScriptAuthTransactionError> {
    let mut ft = FinalTransaction::new(network);

    let witness = ScriptAuth::get_script_auth_witness(1);

    script_auth.add_program_input(&mut ft, program_utxo, Box::new(witness))?;

    let (partial_auth_input, required_sig) = auth_input;

    ft.add_input(partial_auth_input, required_sig)?;

    ft.add_output(unlocked_output);

    Ok(ft)
}
