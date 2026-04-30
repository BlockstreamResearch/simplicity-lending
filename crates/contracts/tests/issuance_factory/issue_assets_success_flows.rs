use lending_contracts::programs::program::SimplexProgram;

use lending_contracts::utils::get_random_seed;
use simplex::transaction::partial_input::IssuanceInput;
use simplex::transaction::{FinalTransaction, PartialInput, PartialOutput, RequiredSignature};

use super::common::tx_steps::finalize_and_broadcast;
use super::setup::setup_issuance_factory;

#[simplex::test]
fn issues_new_assets_without_reissuance_tokens_from_the_0_output(
    context: simplex::TestContext,
) -> anyhow::Result<()> {
    let provider = context.get_default_provider();
    let signer = context.get_default_signer();

    let (issuance_factory, _) = setup_issuance_factory(&context, 2, 0)?;

    let mut ft = FinalTransaction::new();

    let issuance_factory_utxo =
        provider.fetch_scripthash_utxos(&issuance_factory.get_script_pubkey())?[0].clone();
    let policy_utxo = signer.get_utxos_asset(context.get_network().policy_asset())?[0].clone();

    let issuance_entropy = get_random_seed();
    let first_asset_amount = 1000;
    let second_asset_amount = 2000;

    let factory_issuance_input =
        IssuanceInput::new_issuance(first_asset_amount, 0, issuance_entropy);
    let first_issuance_details = issuance_factory.attach_assets_issuing(
        &mut ft,
        issuance_factory_utxo,
        factory_issuance_input,
    );

    let second_issuance_details = ft.add_issuance_input(
        PartialInput::new(policy_utxo),
        IssuanceInput::new_issuance(second_asset_amount, 0, issuance_entropy),
        RequiredSignature::NativeEcdsa,
    );

    ft.add_output(PartialOutput::new(
        signer.get_address().script_pubkey(),
        first_asset_amount,
        first_issuance_details.asset_id,
    ));
    ft.add_output(PartialOutput::new(
        signer.get_address().script_pubkey(),
        second_asset_amount,
        second_issuance_details.asset_id,
    ));

    let txid = finalize_and_broadcast(&context, &ft)?;
    provider.wait(&txid)?;

    Ok(())
}

#[simplex::test]
fn issues_new_assets_without_reissuance_tokens_from_the_2_output(
    context: simplex::TestContext,
) -> anyhow::Result<()> {
    let provider = context.get_default_provider();
    let alice = context.get_default_signer();
    let bob = context.random_signer();

    let (issuance_factory, _) = setup_issuance_factory(&context, 3, 0)?;

    let mut ft = FinalTransaction::new();

    let policy_asset_id = context.get_network().policy_asset();
    let issuance_factory_utxo =
        provider.fetch_scripthash_utxos(&issuance_factory.get_script_pubkey())?[0].clone();
    let policy_utxos = alice.get_utxos_asset(policy_asset_id)?;
    let first_policy_utxo = policy_utxos[0].clone();
    let second_policy_utxo = policy_utxos[1].clone();

    let issuance_entropy = get_random_seed();
    let first_asset_amount = 1000;
    let second_asset_amount = 2000;
    let third_asset_amount = 3000;

    let first_outputs_amount = first_policy_utxo.explicit_amount() / 4;

    ft.add_output(
        PartialOutput::new(
            bob.get_confidential_address().script_pubkey(),
            first_outputs_amount,
            policy_asset_id,
        )
        .with_blinding_key(bob.get_blinding_public_key()),
    );
    ft.add_output(
        PartialOutput::new(
            bob.get_confidential_address().script_pubkey(),
            first_outputs_amount,
            policy_asset_id,
        )
        .with_blinding_key(bob.get_blinding_public_key()),
    );

    let factory_issuance_input =
        IssuanceInput::new_issuance(first_asset_amount, 0, issuance_entropy);
    let first_issuance_details = issuance_factory.attach_assets_issuing(
        &mut ft,
        issuance_factory_utxo,
        factory_issuance_input,
    );

    let second_issuance_details = ft.add_issuance_input(
        PartialInput::new(first_policy_utxo),
        IssuanceInput::new_issuance(second_asset_amount, 0, issuance_entropy),
        RequiredSignature::NativeEcdsa,
    );
    let third_issuance_details = ft.add_issuance_input(
        PartialInput::new(second_policy_utxo),
        IssuanceInput::new_issuance(third_asset_amount, 0, issuance_entropy),
        RequiredSignature::NativeEcdsa,
    );

    ft.add_output(PartialOutput::new(
        alice.get_address().script_pubkey(),
        first_asset_amount,
        first_issuance_details.asset_id,
    ));
    ft.add_output(PartialOutput::new(
        alice.get_address().script_pubkey(),
        second_asset_amount,
        second_issuance_details.asset_id,
    ));
    ft.add_output(PartialOutput::new(
        alice.get_address().script_pubkey(),
        third_asset_amount,
        third_issuance_details.asset_id,
    ));

    assert_eq!(ft.n_outputs(), 6);

    let txid = finalize_and_broadcast(&context, &ft)?;
    provider.wait(&txid)?;

    Ok(())
}

#[simplex::test]
fn issues_new_assets_with_reissuance_tokens_from_the_0_output(
    context: simplex::TestContext,
) -> anyhow::Result<()> {
    let provider = context.get_default_provider();
    let signer = context.get_default_signer();

    let (issuance_factory, _) = setup_issuance_factory(&context, 2, 1)?;

    let mut ft = FinalTransaction::new();

    let issuance_factory_utxo =
        provider.fetch_scripthash_utxos(&issuance_factory.get_script_pubkey())?[0].clone();
    let policy_utxo = signer.get_utxos_asset(context.get_network().policy_asset())?[0].clone();

    let issuance_entropy = get_random_seed();
    let first_asset_amount = 1000;
    let first_inflation_amount = 5;
    let second_asset_amount = 2000;

    let factory_issuance_input =
        IssuanceInput::new_issuance(first_asset_amount, first_inflation_amount, issuance_entropy);
    let first_issuance_details = issuance_factory.attach_assets_issuing(
        &mut ft,
        issuance_factory_utxo,
        factory_issuance_input,
    );

    let second_issuance_details = ft.add_issuance_input(
        PartialInput::new(policy_utxo),
        IssuanceInput::new_issuance(second_asset_amount, 0, issuance_entropy),
        RequiredSignature::NativeEcdsa,
    );

    ft.add_output(PartialOutput::new(
        signer.get_address().script_pubkey(),
        first_asset_amount,
        first_issuance_details.asset_id,
    ));
    ft.add_output(PartialOutput::new(
        signer.get_address().script_pubkey(),
        second_asset_amount,
        second_issuance_details.asset_id,
    ));
    ft.add_output(
        PartialOutput::new(
            signer.get_address().script_pubkey(),
            first_inflation_amount,
            first_issuance_details.inflation_asset_id,
        )
        .with_blinding_key(signer.get_blinding_public_key()),
    );

    let txid = finalize_and_broadcast(&context, &ft)?;
    provider.wait(&txid)?;

    Ok(())
}

#[simplex::test]
fn issues_new_assets_with_reissuance_tokens_from_the_2_output(
    context: simplex::TestContext,
) -> anyhow::Result<()> {
    let provider = context.get_default_provider();
    let alice = context.get_default_signer();
    let bob = context.random_signer();

    let (issuance_factory, _) = setup_issuance_factory(&context, 3, 5)?;

    let mut ft = FinalTransaction::new();

    let policy_asset_id = context.get_network().policy_asset();
    let issuance_factory_utxo =
        provider.fetch_scripthash_utxos(&issuance_factory.get_script_pubkey())?[0].clone();
    let policy_utxos = alice.get_utxos_asset(policy_asset_id)?;
    let first_policy_utxo = policy_utxos[0].clone();
    let second_policy_utxo = policy_utxos[1].clone();

    let issuance_entropy = get_random_seed();
    let first_asset_amount = 1000;
    let first_inflation_amount = 5;
    let second_asset_amount = 2000;
    let third_asset_amount = 3000;
    let third_inflation_amount = 15;

    let first_outputs_amount = first_policy_utxo.explicit_amount() / 4;

    ft.add_output(
        PartialOutput::new(
            bob.get_confidential_address().script_pubkey(),
            first_outputs_amount,
            policy_asset_id,
        )
        .with_blinding_key(bob.get_blinding_public_key()),
    );
    ft.add_output(
        PartialOutput::new(
            bob.get_confidential_address().script_pubkey(),
            first_outputs_amount,
            policy_asset_id,
        )
        .with_blinding_key(bob.get_blinding_public_key()),
    );

    let factory_issuance_input =
        IssuanceInput::new_issuance(first_asset_amount, first_inflation_amount, issuance_entropy);
    let first_issuance_details = issuance_factory.attach_assets_issuing(
        &mut ft,
        issuance_factory_utxo,
        factory_issuance_input,
    );

    let second_issuance_details = ft.add_issuance_input(
        PartialInput::new(first_policy_utxo),
        IssuanceInput::new_issuance(second_asset_amount, 0, issuance_entropy),
        RequiredSignature::NativeEcdsa,
    );
    let third_issuance_details = ft.add_issuance_input(
        PartialInput::new(second_policy_utxo),
        IssuanceInput::new_issuance(third_asset_amount, third_inflation_amount, issuance_entropy),
        RequiredSignature::NativeEcdsa,
    );

    ft.add_output(PartialOutput::new(
        alice.get_address().script_pubkey(),
        first_asset_amount,
        first_issuance_details.asset_id,
    ));
    ft.add_output(PartialOutput::new(
        alice.get_address().script_pubkey(),
        second_asset_amount,
        second_issuance_details.asset_id,
    ));
    ft.add_output(PartialOutput::new(
        alice.get_address().script_pubkey(),
        third_asset_amount,
        third_issuance_details.asset_id,
    ));
    ft.add_output(
        PartialOutput::new(
            alice.get_address().script_pubkey(),
            first_inflation_amount,
            first_issuance_details.inflation_asset_id,
        )
        .with_blinding_key(alice.get_blinding_public_key()),
    );
    ft.add_output(
        PartialOutput::new(
            alice.get_address().script_pubkey(),
            third_inflation_amount,
            third_issuance_details.inflation_asset_id,
        )
        .with_blinding_key(alice.get_blinding_public_key()),
    );

    assert_eq!(ft.n_outputs(), 8);

    let txid = finalize_and_broadcast(&context, &ft)?;
    provider.wait(&txid)?;

    Ok(())
}
