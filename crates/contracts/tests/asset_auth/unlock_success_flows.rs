use lending_contracts::programs::asset_auth::AssetAuthWitnessParams;
use lending_contracts::programs::program::SimplexProgram;

use simplex::simplicityhl::elements::Script;
use simplex::transaction::{FinalTransaction, PartialInput, PartialOutput, RequiredSignature};

use super::common::tx_steps::finalize_and_broadcast;
use super::setup::setup_asset_auth;

#[simplex::test]
fn unlocks_without_burn_with_one_explicit_output(
    context: simplex::TestContext,
) -> anyhow::Result<()> {
    let provider = context.get_default_provider();
    let signer = context.get_default_signer();

    let (asset_auth, asset_auth_parameters) = setup_asset_auth(&context, 1, false)?;

    let mut ft = FinalTransaction::new();

    let auth_utxo = signer.get_utxos_asset(asset_auth_parameters.asset_id)?[0].clone();

    let asset_auth_utxo =
        provider.fetch_scripthash_utxos(&asset_auth.get_script_pubkey())?[0].clone();
    let asset_auth_witness_params = AssetAuthWitnessParams::new(1, 1);

    asset_auth.attach_unlocking(&mut ft, asset_auth_utxo.clone(), asset_auth_witness_params);

    ft.add_input(PartialInput::new(auth_utxo), RequiredSignature::NativeEcdsa);

    ft.add_output(PartialOutput::new(
        signer.get_address().script_pubkey(),
        asset_auth_utxo.explicit_amount(),
        asset_auth_utxo.explicit_asset(),
    ));
    ft.add_output(PartialOutput::new(
        signer.get_address().script_pubkey(),
        asset_auth_parameters.asset_amount,
        asset_auth_parameters.asset_id,
    ));

    let txid = finalize_and_broadcast(&context, &ft)?;
    provider.wait(&txid)?;

    Ok(())
}

#[simplex::test]
fn unlocks_without_burn_with_multiple_explicit_outputs(
    context: simplex::TestContext,
) -> anyhow::Result<()> {
    let provider = context.get_default_provider();
    let signer = context.get_default_signer();

    let (asset_auth, asset_auth_parameters) = setup_asset_auth(&context, 1, false)?;

    let mut ft = FinalTransaction::new();

    let auth_utxo = signer.get_utxos_asset(asset_auth_parameters.asset_id)?[0].clone();

    let asset_auth_utxo =
        provider.fetch_scripthash_utxos(&asset_auth.get_script_pubkey())?[0].clone();
    let asset_auth_witness_params = AssetAuthWitnessParams::new(1, 0);

    asset_auth.attach_unlocking(&mut ft, asset_auth_utxo.clone(), asset_auth_witness_params);

    ft.add_input(PartialInput::new(auth_utxo), RequiredSignature::NativeEcdsa);

    ft.add_output(PartialOutput::new(
        signer.get_address().script_pubkey(),
        asset_auth_parameters.asset_amount,
        asset_auth_parameters.asset_id,
    ));

    let first_locked_output_amount = asset_auth_utxo.explicit_amount() / 2;
    let second_locked_output_amount =
        asset_auth_utxo.explicit_amount() - first_locked_output_amount;

    ft.add_output(PartialOutput::new(
        signer.get_address().script_pubkey(),
        first_locked_output_amount,
        asset_auth_utxo.explicit_asset(),
    ));
    ft.add_output(PartialOutput::new(
        signer.get_address().script_pubkey(),
        second_locked_output_amount,
        asset_auth_utxo.explicit_asset(),
    ));

    let txid = finalize_and_broadcast(&context, &ft)?;
    provider.wait(&txid)?;

    Ok(())
}

#[simplex::test]
fn unlocks_without_burn_with_confidential_output(
    context: simplex::TestContext,
) -> anyhow::Result<()> {
    let provider = context.get_default_provider();
    let signer = context.get_default_signer();

    let (asset_auth, asset_auth_parameters) = setup_asset_auth(&context, 1, false)?;

    let mut ft = FinalTransaction::new();

    let auth_utxo = signer.get_utxos_asset(asset_auth_parameters.asset_id)?[0].clone();

    let asset_auth_utxo =
        provider.fetch_scripthash_utxos(&asset_auth.get_script_pubkey())?[0].clone();
    let asset_auth_witness_params = AssetAuthWitnessParams::new(1, 1);

    asset_auth.attach_unlocking(&mut ft, asset_auth_utxo.clone(), asset_auth_witness_params);

    ft.add_input(PartialInput::new(auth_utxo), RequiredSignature::NativeEcdsa);

    ft.add_output(
        PartialOutput::new(
            signer.get_address().script_pubkey(),
            asset_auth_utxo.explicit_amount(),
            asset_auth_utxo.explicit_asset(),
        )
        .with_blinding_key(signer.get_blinding_public_key()),
    );
    ft.add_output(PartialOutput::new(
        signer.get_address().script_pubkey(),
        asset_auth_parameters.asset_amount,
        asset_auth_parameters.asset_id,
    ));

    let txid = finalize_and_broadcast(&context, &ft)?;
    provider.wait(&txid)?;

    Ok(())
}

#[simplex::test]
fn unlocks_with_burn_with_one_explicit_output(context: simplex::TestContext) -> anyhow::Result<()> {
    let provider = context.get_default_provider();
    let signer = context.get_default_signer();

    let (asset_auth, asset_auth_parameters) = setup_asset_auth(&context, 1, true)?;

    let mut ft = FinalTransaction::new();

    let auth_utxo = signer.get_utxos_asset(asset_auth_parameters.asset_id)?[0].clone();

    let asset_auth_utxo =
        provider.fetch_scripthash_utxos(&asset_auth.get_script_pubkey())?[0].clone();
    let asset_auth_witness_params = AssetAuthWitnessParams::new(1, 1);

    asset_auth.attach_unlocking(&mut ft, asset_auth_utxo.clone(), asset_auth_witness_params);

    ft.add_input(PartialInput::new(auth_utxo), RequiredSignature::NativeEcdsa);

    ft.add_output(PartialOutput::new(
        signer.get_address().script_pubkey(),
        asset_auth_utxo.explicit_amount(),
        asset_auth_utxo.explicit_asset(),
    ));
    ft.add_output(PartialOutput::new(
        Script::new_op_return(b"burn"),
        asset_auth_parameters.asset_amount,
        asset_auth_parameters.asset_id,
    ));

    let txid = finalize_and_broadcast(&context, &ft)?;
    provider.wait(&txid)?;

    Ok(())
}

#[simplex::test]
fn unlocks_with_burn_with_multiple_explicit_outputs(
    context: simplex::TestContext,
) -> anyhow::Result<()> {
    let provider = context.get_default_provider();
    let signer = context.get_default_signer();

    let (asset_auth, asset_auth_parameters) = setup_asset_auth(&context, 1, true)?;

    let mut ft = FinalTransaction::new();

    let auth_utxo = signer.get_utxos_asset(asset_auth_parameters.asset_id)?[0].clone();

    let asset_auth_utxo =
        provider.fetch_scripthash_utxos(&asset_auth.get_script_pubkey())?[0].clone();
    let asset_auth_witness_params = AssetAuthWitnessParams::new(1, 1);

    asset_auth.attach_unlocking(&mut ft, asset_auth_utxo.clone(), asset_auth_witness_params);

    ft.add_input(PartialInput::new(auth_utxo), RequiredSignature::NativeEcdsa);

    let first_locked_output_amount = asset_auth_utxo.explicit_amount() / 2;
    let second_locked_output_amount =
        asset_auth_utxo.explicit_amount() - first_locked_output_amount;

    ft.add_output(PartialOutput::new(
        signer.get_address().script_pubkey(),
        first_locked_output_amount,
        asset_auth_utxo.explicit_asset(),
    ));
    ft.add_output(PartialOutput::new(
        Script::new_op_return(b"burn"),
        asset_auth_parameters.asset_amount,
        asset_auth_parameters.asset_id,
    ));
    ft.add_output(PartialOutput::new(
        signer.get_address().script_pubkey(),
        second_locked_output_amount,
        asset_auth_utxo.explicit_asset(),
    ));

    let txid = finalize_and_broadcast(&context, &ft)?;
    provider.wait(&txid)?;

    Ok(())
}
