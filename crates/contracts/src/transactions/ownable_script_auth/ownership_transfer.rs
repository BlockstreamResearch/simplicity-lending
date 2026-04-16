use simplex::{
    simplicityhl::elements::{AssetId, Script, schnorr::XOnlyPublicKey},
    transaction::{FinalTransaction, PartialOutput, UTXO},
};

use crate::programs::{OwnableScriptAuth, OwnableScriptAuthBranch, program::SimplexProgram};

pub fn ownership_transfer(
    program_utxo: UTXO,
    new_owner: XOnlyPublicKey,
    ownable_script_auth: &mut OwnableScriptAuth,
) -> FinalTransaction {
    let mut ft = FinalTransaction::new();

    let parameters = *ownable_script_auth.get_ownable_script_auth_parameters();
    let witness = OwnableScriptAuth::get_ownable_script_auth_witness(
        &OwnableScriptAuthBranch::OwnershipTransfer {
            current_owner: parameters.owner_pubkey,
            new_owner,
            program_output_index: 0,
        },
    );

    let locked_asset = program_utxo.explicit_asset();
    let locked_amount = program_utxo.explicit_amount();

    ownable_script_auth.add_program_input_with_signature(
        &mut ft,
        program_utxo,
        Box::new(witness),
        "SIGNATURE".into(),
    );

    ownable_script_auth.apply_ownership_transfer(new_owner);

    ownable_script_auth.add_program_output(&mut ft, locked_asset, locked_amount);

    ft.add_output(PartialOutput::new(
        Script::new_op_return(new_owner.serialize().as_slice()),
        0,
        AssetId::default(),
    ));

    ft
}
