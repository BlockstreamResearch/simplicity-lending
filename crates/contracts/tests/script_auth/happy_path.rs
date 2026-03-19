use lending_contracts::artifacts::script_auth::derived_script_auth::ScriptAuthArguments;
use lending_contracts::programs::ScriptAuth;
use lending_contracts::programs::program::SimplexProgram;
use lending_contracts::transactions::script_auth::{create_script_auth, unlock_script_auth};

use simplex::simplicityhl::elements::Txid;
use simplex::transaction::{PartialInput, PartialOutput, RequiredSignature};
use simplex::utils::hash_script;

use super::common::tx_steps::{finalize_and_broadcast, wait_for_tx};
use super::common::wallet::split_first_signer_utxo;

pub(super) fn create_script_auth_tx(
    context: &simplex::TestContext,
    script_hash: [u8; 32],
) -> anyhow::Result<(Txid, ScriptAuth)> {
    let signer = context.get_signer();

    let signer_utxos = signer.get_wpkh_utxos().unwrap();
    let first_utxo = signer_utxos.first().unwrap();

    let (ft, script_auth) = create_script_auth(
        (
            PartialInput::new(first_utxo.0, first_utxo.1.clone()),
            RequiredSignature::NativeEcdsa,
        ),
        *context.get_network(),
        ScriptAuthArguments { script_hash },
    )?;

    let txid = finalize_and_broadcast(context, &ft)?;

    Ok((txid, script_auth))
}

pub(super) fn unlock_script_auth_tx(
    context: &simplex::TestContext,
    script_auth: ScriptAuth,
) -> anyhow::Result<Txid> {
    let provider = context.get_provider();
    let signer = context.get_signer();

    let signer_utxos = signer.get_wpkh_utxos().unwrap();
    let first_utxo = signer_utxos.first().unwrap();
    let auth_input = PartialInput::new(first_utxo.0, first_utxo.1.clone());

    let found_script_auth_utxos =
        provider.fetch_scripthash_utxos(&script_auth.get_script_pubkey()?)?;
    let script_auth_utxo = found_script_auth_utxos.first().unwrap();

    let signer_script = signer.get_wpkh_address().unwrap().script_pubkey();
    let unlocked_output = PartialOutput::new(
        signer_script,
        script_auth_utxo.1.value.explicit().unwrap(),
        script_auth_utxo.1.asset.explicit().unwrap(),
    );

    let ft = unlock_script_auth(
        (script_auth_utxo.0, script_auth_utxo.1.clone()),
        (auth_input, RequiredSignature::NativeEcdsa),
        unlocked_output,
        script_auth,
        *context.get_network(),
    )?;

    let txid = finalize_and_broadcast(context, &ft)?;

    Ok(txid)
}

#[simplex::test]
fn creates_and_unlocks_script_auth(context: simplex::TestContext) -> anyhow::Result<()> {
    let signer = context.get_signer();

    let txid = split_first_signer_utxo(&context, vec![1000, 5000, 10000]);
    wait_for_tx(&context, &txid)?;

    let signer_script_pubkey = signer.get_wpkh_address().unwrap().script_pubkey();
    let signer_script_hash = hash_script(&signer_script_pubkey);

    let (txid, script_auth) = create_script_auth_tx(&context, signer_script_hash)?;
    wait_for_tx(&context, &txid)?;

    let txid = unlock_script_auth_tx(&context, script_auth)?;
    wait_for_tx(&context, &txid)?;

    Ok(())
}
