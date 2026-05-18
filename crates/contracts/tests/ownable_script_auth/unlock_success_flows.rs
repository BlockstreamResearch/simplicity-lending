use lending_contracts::programs::program::SimplexProgram;
use simplex::transaction::{FinalTransaction, PartialInput, RequiredSignature};

use super::setup::setup_ownable_script_auth;

#[simplex::test]
fn unlocks_with_one_explicit_output(context: simplex::TestContext) -> anyhow::Result<()> {
    let provider = context.get_default_provider();
    let alice = context.get_default_signer();

    let (ownable_script_auth, _) = setup_ownable_script_auth(&context)?;

    let ownable_script_auth_utxo =
        provider.fetch_scripthash_utxos(&ownable_script_auth.get_script_pubkey())?[0].clone();
    let auth_utxo = alice.get_utxos()?[0].clone();

    let mut ft = FinalTransaction::new();

    ft.add_input(PartialInput::new(auth_utxo), RequiredSignature::NativeEcdsa);

    ownable_script_auth.attach_unlocking(&mut ft, ownable_script_auth_utxo, 0);

    alice.broadcast(&ft)?.wait()?;

    Ok(())
}
