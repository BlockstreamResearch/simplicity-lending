use simplex::utils::hash_script;

use crate::script_auth_tests::{
    common::{tx_steps::wait_for_tx, wallet::split_first_signer_utxo},
    support::{create_ownable_script_auth_tx, ownership_transfer_tx},
};

#[simplex::test]
fn ownable_script_auth_ownership_transfer(context: simplex::TestContext) -> anyhow::Result<()> {
    let alice = context.get_default_signer();
    let bob = context
        .create_signer("sing slogan bar group gauge sphere rescue fossil loyal vital model desert");

    let txid = split_first_signer_utxo(&context, vec![1000, 5000, 10000]);
    wait_for_tx(&context, &txid)?;

    let signer_script_pubkey = alice.get_address().script_pubkey();
    let signer_script_hash = hash_script(&signer_script_pubkey);

    let (txid, ownable_script_auth) = create_ownable_script_auth_tx(&context, signer_script_hash)?;
    wait_for_tx(&context, &txid)?;

    let txid = ownership_transfer_tx(&context, bob.get_schnorr_public_key(), ownable_script_auth)?;
    wait_for_tx(&context, &txid)?;

    Ok(())
}
