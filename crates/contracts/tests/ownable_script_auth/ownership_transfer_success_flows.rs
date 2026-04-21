use lending_contracts::programs::program::SimplexProgram;
use simplex::transaction::FinalTransaction;

use super::common::tx_steps::finalize_and_broadcast;
use super::setup::setup_ownable_script_auth;

#[simplex::test]
fn transfers_ownership_several_times(context: simplex::TestContext) -> anyhow::Result<()> {
    let provider = context.get_default_provider();
    let alice = context.get_default_signer();
    let bob = context
        .create_signer("sing slogan bar group gauge sphere rescue fossil loyal vital model desert");

    let txid = alice.send(bob.get_address().script_pubkey(), 500)?;
    provider.wait(&txid)?;

    let (mut ownable_script_auth, _) = setup_ownable_script_auth(&context)?;

    let ownable_script_auth_utxo =
        provider.fetch_scripthash_utxos(&ownable_script_auth.get_script_pubkey())?[0].clone();

    let mut ft = FinalTransaction::new();

    ownable_script_auth.attach_ownership_transfer(
        &mut ft,
        ownable_script_auth_utxo,
        bob.get_schnorr_public_key(),
    );

    assert!(
        ownable_script_auth.get_parameters().owner_pubkey == bob.get_schnorr_public_key(),
        "Failed to transfer ownership"
    );

    let txid = finalize_and_broadcast(&context, &ft)?;
    provider.wait(&txid)?;

    let ownable_script_auth_utxo =
        provider.fetch_scripthash_utxos(&ownable_script_auth.get_script_pubkey())?[0].clone();

    let mut ft = FinalTransaction::new();

    ownable_script_auth.attach_ownership_transfer(
        &mut ft,
        ownable_script_auth_utxo,
        alice.get_schnorr_public_key(),
    );

    assert!(
        ownable_script_auth.get_parameters().owner_pubkey == alice.get_schnorr_public_key(),
        "Failed to transfer ownership"
    );

    let (tx, _) = bob.finalize(&ft).unwrap();
    let txid = provider.broadcast_transaction(&tx).unwrap();
    provider.wait(&txid)?;

    Ok(())
}
