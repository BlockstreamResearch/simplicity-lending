use lending_contracts::programs::program::SimplexProgram;
use lending_contracts::programs::{AssetAuth, AssetAuthParameters};
use lending_contracts::transactions::asset_auth::{create_asset_auth, unlock_asset_auth};

use lending_contracts::transactions::core::SimplexInput;
use simplex::simplicityhl::elements::Txid;
use simplex::transaction::{PartialOutput, RequiredSignature};

use crate::common::issuance::issue_asset;
use crate::common::tx_steps::finalize_and_broadcast;
use crate::common::wallet::{filter_signer_utxos_by_asset_id, split_first_signer_utxo};

pub(super) fn create_asset_auth_tx(
    context: &simplex::TestContext,
    parameters: AssetAuthParameters,
) -> anyhow::Result<(Txid, AssetAuth)> {
    let network = context.get_network();
    let signer = context.get_default_signer();

    let policy_utxos = filter_signer_utxos_by_asset_id(signer, network.policy_asset());
    let utxo_to_lock = policy_utxos.first().unwrap();

    let (ft, asset_auth) = create_asset_auth(
        &SimplexInput::new(utxo_to_lock, RequiredSignature::NativeEcdsa),
        parameters,
    );

    let txid = finalize_and_broadcast(context, &ft)?;

    Ok((txid, asset_auth))
}

pub(super) fn unlock_asset_auth_tx(
    context: &simplex::TestContext,
    asset_auth: AssetAuth,
) -> anyhow::Result<Txid> {
    let provider = context.get_default_provider();
    let signer = context.get_default_signer();

    let found_asset_auth_utxos =
        provider.fetch_scripthash_utxos(&asset_auth.get_script_pubkey())?;
    let asset_auth_utxo = found_asset_auth_utxos.first().unwrap();

    let asset_auth_parameters = asset_auth.get_asset_auth_parameters();
    let auth_utxos = filter_signer_utxos_by_asset_id(signer, asset_auth_parameters.asset_id);
    let auth_utxo = auth_utxos.first().unwrap();

    let signer_script_pubkey = signer.get_address().script_pubkey();
    let ft = unlock_asset_auth(
        asset_auth_utxo.clone(),
        &SimplexInput::new(auth_utxo, RequiredSignature::NativeEcdsa),
        PartialOutput::new(
            signer_script_pubkey,
            asset_auth_utxo.explicit_amount(),
            asset_auth_utxo.explicit_asset(),
        ),
        asset_auth,
    );

    finalize_and_broadcast(context, &ft)
}

#[simplex::test]
fn creates_and_unlocks_asset_auth_without_burn(
    context: simplex::TestContext,
) -> anyhow::Result<()> {
    let provider = context.get_default_provider();

    let txid = split_first_signer_utxo(&context, vec![1000]);
    provider.wait(&txid)?;

    let asset_amount = 1;
    let (txid, asset_id) = issue_asset(&context, asset_amount)?;
    provider.wait(&txid)?;

    let asset_auth_parameters = AssetAuthParameters {
        asset_id,
        asset_amount,
        with_asset_burn: false,
        network: *context.get_network(),
    };

    let (txid, asset_auth) = create_asset_auth_tx(&context, asset_auth_parameters)?;
    provider.wait(&txid)?;

    let txid = unlock_asset_auth_tx(&context, asset_auth)?;
    provider.wait(&txid)?;

    Ok(())
}
