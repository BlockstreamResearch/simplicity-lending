use lending_contracts::programs::program::SimplexProgram;
use simplex::transaction::{FinalTransaction, PartialInput, RequiredSignature};

use super::common::tx_steps::finalize_and_broadcast;
use super::setup::setup_ownable_script_auth;

#[simplex::test]
fn unlocks_with_one_explicit_output(context: simplex::TestContext) -> anyhow::Result<()> {
    let provider = context.get_default_provider();
    let alice = context.get_default_signer();
    let bob = context
        .create_signer("sing slogan bar group gauge sphere rescue fossil loyal vital model desert");

    let txid = alice.send(bob.get_address().script_pubkey(), 500)?;
    provider.wait(&txid)?;

    let (ownable_script_auth, _) = setup_ownable_script_auth(&context)?;

    let ownable_script_auth_utxo =
        provider.fetch_scripthash_utxos(&ownable_script_auth.get_script_pubkey())?[0].clone();
    let auth_utxo = alice.get_utxos()?[0].clone();

    let mut ft = FinalTransaction::new();

    ft.add_input(PartialInput::new(auth_utxo), RequiredSignature::NativeEcdsa);

    ownable_script_auth.attach_unlocking(&mut ft, ownable_script_auth_utxo, 0);

    let txid = finalize_and_broadcast(&context, &ft)?;
    provider.wait(&txid)?;

    Ok(())
}
