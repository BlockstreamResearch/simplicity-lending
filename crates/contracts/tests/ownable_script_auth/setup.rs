use lending_contracts::programs::ownable_script_auth::{
    OwnableScriptAuth, OwnableScriptAuthParameters,
};
use simplex::{
    transaction::{FinalTransaction, PartialInput, RequiredSignature},
    utils::hash_script,
};

use super::common::tx_steps::finalize_and_broadcast;
use super::common::wallet::split_first_signer_utxo;

pub(super) fn setup_ownable_script_auth(
    context: &simplex::TestContext,
) -> anyhow::Result<(OwnableScriptAuth, OwnableScriptAuthParameters)> {
    let provider = context.get_default_provider();
    let signer = context.get_default_signer();

    let txid = split_first_signer_utxo(&context, vec![1000, 5000, 10000]);
    provider.wait(&txid)?;

    let signer_script_pubkey = signer.get_address().script_pubkey();
    let signer_script_hash = hash_script(&signer_script_pubkey);

    let ownable_script_auth_parameters = OwnableScriptAuthParameters {
        script_hash: signer_script_hash,
        owner_pubkey: signer.get_schnorr_public_key(),
        network: *context.get_network(),
    };

    let signer_utxos = signer.get_utxos_asset(provider.get_network().policy_asset())?;
    let utxo_to_lock = signer_utxos.first().unwrap();

    let ownable_script_auth = OwnableScriptAuth::new(ownable_script_auth_parameters);

    let mut ft = FinalTransaction::new();

    ft.add_input(
        PartialInput::new(utxo_to_lock.clone()),
        RequiredSignature::NativeEcdsa,
    );

    ownable_script_auth.attach_creation(
        &mut ft,
        utxo_to_lock.explicit_asset(),
        utxo_to_lock.explicit_amount(),
    );

    let txid = finalize_and_broadcast(context, &ft)?;
    provider.wait(&txid)?;

    Ok((ownable_script_auth, ownable_script_auth_parameters))
}
