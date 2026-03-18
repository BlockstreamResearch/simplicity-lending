use lending_contracts::artifacts::script_auth::derived_script_auth::ScriptAuthWitness;
use simplex::simplicityhl::elements::{OutPoint, Script, Txid};
use simplex::transaction::{
    FinalTransaction, PartialInput, PartialOutput, ProgramInput, RequiredSignature,
};
use simplex::utils::tr_unspendable_key;

use lending_contracts::artifacts::script_auth::{
    ScriptAuthProgram, derived_script_auth::ScriptAuthArguments,
};
use simplicityhl_core::hash_script;

fn get_script_auth(context: &simplex::TestContext) -> (ScriptAuthProgram, Script) {
    let signer = context.get_signer();
    let signer_script_pubkey = signer.get_wpkh_address().unwrap().script_pubkey();

    println!("Signer script pubkey - {:?}", signer_script_pubkey);

    let arguments = ScriptAuthArguments {
        script_hash: hash_script(&signer_script_pubkey),
    };

    let script_auth = ScriptAuthProgram::new(tr_unspendable_key(), arguments);
    let script_auth_script = script_auth
        .get_program()
        .get_script_pubkey(context.get_network())
        .unwrap();

    (script_auth, script_auth_script)
}

fn create_script_auth(context: &simplex::TestContext) -> (ScriptAuthProgram, Txid) {
    let signer = context.get_signer();
    let provider = context.get_provider();

    let (script_auth_program, script_auth_script) = get_script_auth(context);

    let mut ft = FinalTransaction::new(*context.get_network());

    ft.add_output(PartialOutput::new(
        script_auth_script,
        1000,
        context.get_network().policy_asset(),
    ));

    let (tx, _) = signer.finalize(&ft, 1).unwrap();
    let res = provider.broadcast_transaction(&tx).unwrap();

    (script_auth_program, res)
}

fn spend_script_auth_covenant(
    context: &simplex::TestContext,
    script_auth: ScriptAuthProgram,
    script_auth_outpoint: OutPoint,
) -> Txid {
    println!("-----spend_script_auth_covenant------");
    let signer = context.get_signer();
    let provider = context.get_provider();

    let script_auth_tx = provider
        .fetch_transaction(&script_auth_outpoint.txid)
        .unwrap();
    let utxos = signer.get_wpkh_utxos().unwrap();
    let first_utxo = utxos.first().unwrap();

    let mut ft = FinalTransaction::new(*context.get_network());

    let witness = ScriptAuthWitness {
        input_script_index: 1,
    };

    ft.add_program_input(
        PartialInput::new(
            script_auth_outpoint,
            script_auth_tx.output[script_auth_outpoint.vout as usize].clone(),
        ),
        ProgramInput::new(
            Box::new(script_auth.get_program().clone()),
            Box::new(witness.clone()),
        ),
        RequiredSignature::None,
    )
    .unwrap();
    // ft.add_input(
    //     PartialInput::new(
    //         first_utxo.0,
    //         first_utxo.1.clone()
    //     ),
    //     RequiredSignature::NativeEcdsa
    // ).unwrap();
    // ft.add_output(PartialOutput::new(
    //     signer.get_wpkh_address().unwrap().script_pubkey(),
    //     1000,
    //     context.get_network().policy_asset(),
    // ));

    let (tx, _) = signer.finalize(&ft, 1).unwrap();

    let res = provider.broadcast_transaction(&tx).unwrap();

    res
}

#[simplex::test]
fn creation_test(context: simplex::TestContext) -> anyhow::Result<()> {
    let provider = context.get_provider();

    let (script_auth_program, txid) = create_script_auth(&context);

    provider.wait(&txid)?;

    println!("ScriptAuth covenant created");

    let tx = spend_script_auth_covenant(&context, script_auth_program, OutPoint { txid, vout: 0 });

    provider.wait(&tx)?;

    println!("ScriptAuth covenant spent");

    Ok(())
}
