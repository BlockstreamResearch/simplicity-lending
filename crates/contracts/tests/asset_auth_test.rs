use lending_contracts::artifacts::asset_auth::derived_asset_auth::AssetAuthArguments;
use lending_contracts::programs::AssetAuth;
use lending_contracts::programs::program::SimplexProgram;
use lending_contracts::transactions::asset_auth::{create_asset_auth, unlock_asset_auth};

use simplex::simplicityhl::elements::hashes::sha256::Midstate;
use simplex::simplicityhl::elements::{AssetId, Txid};
use simplex::transaction::{PartialInput, PartialOutput, RequiredSignature};

pub use utils::{issue_asset, split_first_signer_utxo};

use crate::utils::filter_signer_utxos_by_asset_id;

pub mod utils;

fn create_asset_auth_tx(
    context: &simplex::TestContext,
    asset_id: AssetId,
    asset_amount: u64,
    with_asset_burn: bool,
) -> anyhow::Result<(Txid, AssetAuth)> {
    let provider = context.get_provider();
    let network = context.get_network();
    let signer = context.get_signer();

    let policy_utxos = filter_signer_utxos_by_asset_id(signer, network.policy_asset());

    let utxo_to_lock = policy_utxos.first().unwrap();

    let (ft, asset_auth) = create_asset_auth(
        (
            PartialInput::new(utxo_to_lock.0, utxo_to_lock.1.clone()),
            RequiredSignature::NativeEcdsa,
        ),
        *network,
        AssetAuthArguments {
            asset_id: asset_id.into_inner().0,
            asset_amount,
            with_asset_burn,
        },
    )?;

    let (tx, _) = signer.finalize(&ft, 1).unwrap();

    let txid = provider.broadcast_transaction(&tx).unwrap();

    Ok((txid, asset_auth))
}

fn unlock_asset_auth_tx(
    context: &simplex::TestContext,
    asset_auth: AssetAuth,
) -> anyhow::Result<Txid> {
    let provider = context.get_provider();
    let network = context.get_network();
    let signer = context.get_signer();

    let found_asset_auth_utxos =
        provider.fetch_scripthash_utxos(&asset_auth.get_script_pubkey()?)?;
    let asset_auth_utxo = found_asset_auth_utxos.first().unwrap();

    let asset_auth_arguments = asset_auth.get_asset_auth_arguments();
    let auth_asset_id = AssetId::from_inner(Midstate(asset_auth_arguments.asset_id));

    let auth_utxos = filter_signer_utxos_by_asset_id(signer, auth_asset_id);
    let auth_utxo = auth_utxos.first().unwrap();

    let signer_script_pubkey = signer.get_wpkh_address().unwrap().script_pubkey();

    let ft = unlock_asset_auth(
        (asset_auth_utxo.0, asset_auth_utxo.1.clone()),
        (
            PartialInput::new(auth_utxo.0, auth_utxo.1.clone()),
            RequiredSignature::NativeEcdsa,
        ),
        PartialOutput::new(
            signer_script_pubkey,
            asset_auth_utxo.1.value.explicit().unwrap(),
            asset_auth_utxo.1.asset.explicit().unwrap(),
        ),
        asset_auth,
        *network,
    )?;

    let (tx, _) = signer.finalize(&ft, 1).unwrap();

    let txid = provider.broadcast_transaction(&tx).unwrap();

    Ok(txid)
}

#[simplex::test]
fn create_and_unlock_asset_auth_without_burn_test(
    context: simplex::TestContext,
) -> anyhow::Result<()> {
    let provider = context.get_provider();

    let utxo_amounts = vec![1000];

    let txid = split_first_signer_utxo(&context, utxo_amounts);

    provider.wait(&txid)?;

    let asset_amount = 1;
    let (txid, asset_id) = issue_asset(&context, asset_amount)?;

    provider.wait(&txid)?;

    let (txid, asset_auth) = create_asset_auth_tx(&context, asset_id, asset_amount, false)?;

    provider.wait(&txid)?;

    let txid = unlock_asset_auth_tx(&context, asset_auth)?;

    provider.wait(&txid)?;

    Ok(())
}

#[simplex::test]
fn create_and_unlock_asset_auth_with_burn_test(
    context: simplex::TestContext,
) -> anyhow::Result<()> {
    let provider = context.get_provider();

    let utxo_amounts = vec![1000];

    let txid = split_first_signer_utxo(&context, utxo_amounts);

    provider.wait(&txid)?;

    let asset_amount = 1;
    let (txid, asset_id) = issue_asset(&context, asset_amount)?;

    provider.wait(&txid)?;

    let (txid, asset_auth) = create_asset_auth_tx(&context, asset_id, asset_amount, true)?;

    provider.wait(&txid)?;

    let txid = unlock_asset_auth_tx(&context, asset_auth)?;

    provider.wait(&txid)?;

    let tx = provider.fetch_transaction(&txid)?;

    let burn_output = tx.output[1].clone();

    assert!(burn_output.is_null_data());
    assert_eq!(burn_output.asset.explicit().unwrap(), asset_id);
    assert_eq!(burn_output.value.explicit().unwrap(), asset_amount);

    Ok(())
}
