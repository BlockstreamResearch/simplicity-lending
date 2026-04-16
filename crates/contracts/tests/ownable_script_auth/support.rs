use lending_contracts::programs::program::SimplexProgram;
use lending_contracts::programs::{OwnableScriptAuth, OwnableScriptAuthParameters};
use lending_contracts::transactions::core::SimplexInput;
use lending_contracts::transactions::ownable_script_auth::{
    create_ownable_script_auth, ownable_script_auth_unlock, ownership_transfer,
};

use simplex::simplicityhl::elements::Txid;
use simplex::simplicityhl::elements::schnorr::XOnlyPublicKey;
use simplex::transaction::RequiredSignature;

use super::common::tx_steps::finalize_and_broadcast;

pub(super) fn create_ownable_script_auth_tx(
    context: &simplex::TestContext,
    script_hash: [u8; 32],
) -> anyhow::Result<(Txid, OwnableScriptAuth)> {
    let signer = context.get_default_signer();

    let signer_utxos = signer.get_utxos().unwrap();
    let first_utxo = signer_utxos.first().unwrap();

    let (ft, script_auth) = create_ownable_script_auth(
        &SimplexInput::new(first_utxo, RequiredSignature::NativeEcdsa),
        first_utxo.explicit_amount(),
        OwnableScriptAuthParameters {
            script_hash,
            owner_pubkey: signer.get_schnorr_public_key(),
            network: *context.get_network(),
        },
    );

    let txid = finalize_and_broadcast(context, &ft)?;

    Ok((txid, script_auth))
}

pub(super) fn ownership_transfer_tx(
    context: &simplex::TestContext,
    new_owner_pubkey: XOnlyPublicKey,
    ownable_script_auth: OwnableScriptAuth,
) -> anyhow::Result<Txid> {
    let provider = context.get_default_provider();

    let found_ownable_script_auth_utxos =
        provider.fetch_scripthash_utxos(&ownable_script_auth.get_script_pubkey())?;
    let ownable_script_auth_utxo = found_ownable_script_auth_utxos.first().unwrap();

    let mut ownable_script_auth = ownable_script_auth;

    let ft = ownership_transfer(
        ownable_script_auth_utxo.clone(),
        new_owner_pubkey,
        &mut ownable_script_auth,
    );

    let txid = finalize_and_broadcast(context, &ft)?;

    Ok(txid)
}

pub(super) fn script_auth_unlock_tx(
    context: &simplex::TestContext,
    ownable_script_auth: OwnableScriptAuth,
) -> anyhow::Result<Txid> {
    let provider = context.get_default_provider();
    let signer = context.get_default_signer();

    let found_ownable_script_auth_utxos =
        provider.fetch_scripthash_utxos(&ownable_script_auth.get_script_pubkey())?;
    let ownable_script_auth_utxo = found_ownable_script_auth_utxos.first().unwrap();

    let signer_utxos = signer.get_utxos()?;
    let auth_utxo = signer_utxos.first().unwrap();

    let ft = ownable_script_auth_unlock(
        ownable_script_auth_utxo,
        &SimplexInput::new(auth_utxo, RequiredSignature::NativeEcdsa),
        signer.get_address().script_pubkey(),
        &ownable_script_auth,
    );

    let txid = finalize_and_broadcast(context, &ft)?;

    Ok(txid)
}
