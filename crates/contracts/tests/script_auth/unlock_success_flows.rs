use lending_contracts::programs::program::SimplexProgram;
use lending_contracts::programs::script_auth::{
    ScriptAuth, ScriptAuthParameters, ScriptAuthWitnessParams,
};
use simplex::transaction::PartialOutput;
use simplex::{
    transaction::{FinalTransaction, PartialInput, RequiredSignature},
    utils::hash_script,
};

use super::common::tx_steps::finalize_and_broadcast;
use super::common::wallet::split_first_signer_utxo;

fn setup_script_auth(
    context: &simplex::TestContext,
) -> anyhow::Result<(ScriptAuth, ScriptAuthParameters)> {
    let provider = context.get_default_provider();
    let signer = context.get_default_signer();

    let txid = split_first_signer_utxo(&context, vec![1000, 5000, 10000]);
    provider.wait(&txid)?;

    let signer_script_pubkey = signer.get_address().script_pubkey();
    let signer_script_hash = hash_script(&signer_script_pubkey);

    let script_auth_parameters = ScriptAuthParameters {
        script_hash: signer_script_hash,
        network: *context.get_network(),
    };

    let signer_utxos = signer.get_utxos_asset(provider.get_network().policy_asset())?;
    let utxo_to_lock = signer_utxos.first().unwrap();

    let mut ft = FinalTransaction::new();
    let script_auth = ScriptAuth::new(script_auth_parameters);

    script_auth.attach_creation(
        &mut ft,
        utxo_to_lock.explicit_asset(),
        utxo_to_lock.explicit_amount(),
    );

    let txid = finalize_and_broadcast(context, &ft)?;
    provider.wait(&txid)?;

    Ok((script_auth, script_auth_parameters))
}

#[simplex::test]
fn unlocks_with_one_explicit_output(context: simplex::TestContext) -> anyhow::Result<()> {
    let provider = context.get_default_provider();
    let signer = context.get_default_signer();

    let (script_auth, _) = setup_script_auth(&context)?;

    let script_auth_utxo =
        provider.fetch_scripthash_utxos(&script_auth.get_script_pubkey())?[0].clone();
    let script_auth_witness_params = ScriptAuthWitnessParams::new(1);

    let auth_utxo = signer.get_utxos()?[0].clone();

    let mut ft = FinalTransaction::new();

    script_auth.attach_unlocking(
        &mut ft,
        script_auth_utxo.clone(),
        script_auth_witness_params,
    );
    ft.add_input(
        PartialInput::new(auth_utxo.clone()),
        RequiredSignature::NativeEcdsa,
    );

    ft.add_output(PartialOutput::new(
        signer.get_address().script_pubkey(),
        script_auth_utxo.explicit_amount(),
        script_auth_utxo.explicit_asset(),
    ));
    ft.add_output(PartialOutput::new(
        signer.get_address().script_pubkey(),
        auth_utxo.explicit_amount(),
        auth_utxo.explicit_asset(),
    ));

    Ok(())
}

#[simplex::test]
fn unlocks_with_multiple_explicit_outputs(context: simplex::TestContext) -> anyhow::Result<()> {
    let provider = context.get_default_provider();
    let signer = context.get_default_signer();

    let (script_auth, _) = setup_script_auth(&context)?;

    let script_auth_utxo =
        provider.fetch_scripthash_utxos(&script_auth.get_script_pubkey())?[0].clone();
    let script_auth_witness_params = ScriptAuthWitnessParams::new(1);

    let auth_utxo = signer.get_utxos()?[0].clone();

    let mut ft = FinalTransaction::new();

    script_auth.attach_unlocking(
        &mut ft,
        script_auth_utxo.clone(),
        script_auth_witness_params,
    );
    ft.add_input(
        PartialInput::new(auth_utxo.clone()),
        RequiredSignature::NativeEcdsa,
    );

    let first_locked_output_amount = script_auth_utxo.explicit_amount() / 2;
    let second_locked_output_amount =
        script_auth_utxo.explicit_amount() - first_locked_output_amount;

    ft.add_output(PartialOutput::new(
        signer.get_address().script_pubkey(),
        first_locked_output_amount,
        script_auth_utxo.explicit_asset(),
    ));
    ft.add_output(PartialOutput::new(
        signer.get_address().script_pubkey(),
        auth_utxo.explicit_amount(),
        auth_utxo.explicit_asset(),
    ));
    ft.add_output(PartialOutput::new(
        signer.get_address().script_pubkey(),
        second_locked_output_amount,
        script_auth_utxo.explicit_asset(),
    ));

    Ok(())
}

#[simplex::test]
fn unlocks_with_confidential_output(context: simplex::TestContext) -> anyhow::Result<()> {
    let provider = context.get_default_provider();
    let signer = context.get_default_signer();

    let (script_auth, _) = setup_script_auth(&context)?;

    let script_auth_utxo =
        provider.fetch_scripthash_utxos(&script_auth.get_script_pubkey())?[0].clone();
    let script_auth_witness_params = ScriptAuthWitnessParams::new(1);

    let auth_utxo = signer.get_utxos()?[0].clone();

    let mut ft = FinalTransaction::new();

    script_auth.attach_unlocking(
        &mut ft,
        script_auth_utxo.clone(),
        script_auth_witness_params,
    );
    ft.add_input(
        PartialInput::new(auth_utxo.clone()),
        RequiredSignature::NativeEcdsa,
    );

    ft.add_output(
        PartialOutput::new(
            signer.get_address().script_pubkey(),
            script_auth_utxo.explicit_amount(),
            script_auth_utxo.explicit_asset(),
        )
        .with_blinding_key(signer.get_blinding_public_key()),
    );
    ft.add_output(PartialOutput::new(
        signer.get_address().script_pubkey(),
        auth_utxo.explicit_amount(),
        auth_utxo.explicit_asset(),
    ));

    Ok(())
}
