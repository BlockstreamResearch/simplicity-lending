use lending_contracts::programs::asset_auth::{AssetAuthParameters, AssetAuthWitnessParams};
use lending_contracts::programs::program::SimplexProgram;

use simplex::transaction::{FinalTransaction, PartialInput, PartialOutput, RequiredSignature};

use crate::asset_auth_tests::common::tx_steps::finalize_and_broadcast;
use crate::asset_auth_tests::common::wallet::get_split_utxo_ft;

use super::setup::setup_asset_auth;

fn split_auth_utxo(
    context: &simplex::TestContext,
    amounts: Vec<u64>,
    asset_auth_parameters: AssetAuthParameters,
) -> anyhow::Result<()> {
    let signer = context.get_default_signer();

    let auth_utxo = signer.get_utxos_asset(asset_auth_parameters.asset_id)?[0].clone();

    let ft = get_split_utxo_ft(auth_utxo, amounts, signer, *context.get_network());

    let txid = finalize_and_broadcast(context, &ft)?;
    context.get_default_provider().wait(&txid)?;

    Ok(())
}

#[simplex::test]
fn fails_to_unlock_when_auth_input_amount_is_invalid(
    context: simplex::TestContext,
) -> anyhow::Result<()> {
    let provider = context.get_default_provider();
    let signer = context.get_default_signer();

    let asset_amount = 1000;
    let (asset_auth, asset_auth_parameters) = setup_asset_auth(&context, asset_amount, false)?;

    let mut ft = FinalTransaction::new();

    let new_amounts = vec![450, 550];
    split_auth_utxo(&context, new_amounts, asset_auth_parameters)?;

    let auth_utxo = signer.get_utxos_asset(asset_auth_parameters.asset_id)?[0].clone();

    let asset_auth_utxo =
        provider.fetch_scripthash_utxos(&asset_auth.get_script_pubkey())?[0].clone();
    let asset_auth_witness_params = AssetAuthWitnessParams::new(1, 1);

    asset_auth.attach_unlocking(&mut ft, asset_auth_utxo.clone(), asset_auth_witness_params);

    ft.add_input(
        PartialInput::new(auth_utxo.clone()),
        RequiredSignature::NativeEcdsa,
    );

    ft.add_output(PartialOutput::new(
        signer.get_address().script_pubkey(),
        asset_auth_utxo.explicit_amount(),
        asset_auth_utxo.explicit_asset(),
    ));
    ft.add_output(PartialOutput::new(
        signer.get_address().script_pubkey(),
        auth_utxo.explicit_amount(),
        auth_utxo.explicit_asset(),
    ));

    let result = signer.finalize(&ft);

    assert!(
        result.is_err(),
        "expected finalize to fail, but it succeeded"
    );

    Ok(())
}
