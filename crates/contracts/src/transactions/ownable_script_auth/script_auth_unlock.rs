use simplex::{
    simplicityhl::elements::Script,
    transaction::{FinalTransaction, PartialOutput, UTXO},
};

use crate::{
    programs::{OwnableScriptAuth, OwnableScriptAuthBranch, program::SimplexProgram},
    transactions::core::SimplexInput,
};

pub fn ownable_script_auth_unlock(
    program_utxo: &UTXO,
    auth_input: &SimplexInput,
    program_output_script: Script,
    ownable_script_auth: &OwnableScriptAuth,
) -> FinalTransaction {
    let mut ft = FinalTransaction::new();

    let parameters = *ownable_script_auth.get_ownable_script_auth_parameters();
    let witness = OwnableScriptAuth::get_ownable_script_auth_witness(
        &OwnableScriptAuthBranch::ScriptAuthUnlock {
            owner: parameters.owner_pubkey,
            input_script_index: 1,
        },
    );

    let locked_asset = program_utxo.explicit_asset();
    let locked_amount = program_utxo.explicit_amount();

    ownable_script_auth.add_program_input_with_signature(
        &mut ft,
        program_utxo.clone(),
        Box::new(witness),
        "SIGNATURE".into(),
    );
    ft.add_input(
        auth_input.partial_input().clone(),
        auth_input.required_sig().clone(),
    );

    ft.add_output(PartialOutput::new(
        program_output_script,
        locked_amount,
        locked_asset,
    ));
    ft.add_output(auth_input.new_partial_output());

    ft
}
