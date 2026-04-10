use simplex::utils::hash_script;

use crate::script_auth_tests::{
    common::{tx_steps::wait_for_tx, wallet::split_first_signer_utxo},
    support::{create_ownable_script_auth_tx, script_auth_unlock_tx},
};

#[simplex::test]
fn ownable_script_auth_unlock(context: simplex::TestContext) -> anyhow::Result<()> {
    let alice = context.get_default_signer();

    let txid = split_first_signer_utxo(&context, vec![1000, 5000, 10000]);
    wait_for_tx(&context, &txid)?;

    let signer_script_pubkey = alice.get_address().script_pubkey();
    let signer_script_hash = hash_script(&signer_script_pubkey);

    let (txid, ownable_script_auth) = create_ownable_script_auth_tx(&context, signer_script_hash)?;
    wait_for_tx(&context, &txid)?;

    let txid = script_auth_unlock_tx(&context, ownable_script_auth)?;
    wait_for_tx(&context, &txid)?;

    Ok(())
}
