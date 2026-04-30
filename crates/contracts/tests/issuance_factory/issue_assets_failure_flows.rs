use lending_contracts::{programs::program::SimplexProgram, utils::get_random_seed};

use simplex::transaction::{
    FinalTransaction, PartialInput, PartialOutput, RequiredSignature, partial_input::IssuanceInput,
};

use super::setup::setup_issuance_factory;

#[simplex::test]
fn fails_to_issue_wrong_assets_number(context: simplex::TestContext) -> anyhow::Result<()> {
    let provider = context.get_default_provider();
    let signer = context.get_default_signer();

    let (issuance_factory, _) = setup_issuance_factory(&context, 3, 0)?;

    let mut ft = FinalTransaction::new();

    let policy_asset_id = context.get_network().policy_asset();
    let issuance_factory_utxo =
        provider.fetch_scripthash_utxos(&issuance_factory.get_script_pubkey())?[0].clone();
    let policy_utxo = signer.get_utxos_asset(policy_asset_id)?[0].clone();

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

    let result = signer.finalize(&ft);

    assert!(result.is_err(), "Must fail but it does not");

    Ok(())
}

#[simplex::test]
fn fails_to_issue_assets_with_reissuance_tokens(
    context: simplex::TestContext,
) -> anyhow::Result<()> {
    let provider = context.get_default_provider();
    let signer = context.get_default_signer();

    let (issuance_factory, _) = setup_issuance_factory(&context, 2, 0)?;

    let mut ft = FinalTransaction::new();

    let policy_asset_id = context.get_network().policy_asset();
    let issuance_factory_utxo =
        provider.fetch_scripthash_utxos(&issuance_factory.get_script_pubkey())?[0].clone();
    let policy_utxo = signer.get_utxos_asset(policy_asset_id)?[0].clone();

    let issuance_entropy = get_random_seed();
    let first_asset_amount = 1000;
    let first_inflation_amount = 10;
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

    let result = signer.finalize(&ft);

    assert!(result.is_err(), "Must fail but it does not");

    Ok(())
}

#[simplex::test]
fn fails_to_issue_assets_without_reissuance_tokens(
    context: simplex::TestContext,
) -> anyhow::Result<()> {
    let provider = context.get_default_provider();
    let signer = context.get_default_signer();

    let (issuance_factory, _) = setup_issuance_factory(&context, 2, 2)?;

    let mut ft = FinalTransaction::new();

    let policy_asset_id = context.get_network().policy_asset();
    let issuance_factory_utxo =
        provider.fetch_scripthash_utxos(&issuance_factory.get_script_pubkey())?[0].clone();
    let policy_utxo = signer.get_utxos_asset(policy_asset_id)?[0].clone();

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

    let result = signer.finalize(&ft);

    assert!(result.is_err(), "Must fail but it does not");

    Ok(())
}
