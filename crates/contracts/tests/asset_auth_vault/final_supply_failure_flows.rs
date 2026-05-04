use lending_contracts::programs::asset_auth_vault::{AssetAuthVault, AssetAuthVaultParameters};
use lending_contracts::programs::program::SimplexProgram;

use simplex::simplicityhl::elements::Script;
use simplex::transaction::{FinalTransaction, PartialInput, PartialOutput, RequiredSignature};

use super::setup::{final_supply, issue_auth_assets, prepare_vault_asset, setup_asset_auth_vault};

fn default_final_vault_supplying_setup(
    context: &simplex::TestContext,
    with_supplier_asset_burn: bool,
) -> anyhow::Result<(AssetAuthVault, AssetAuthVaultParameters)> {
    let (supplier_auth_asset_id, keeper_auth_asset_id) = issue_auth_assets(context, 1, 1)?;

    let vault_asset_amount = 1_000_000;
    let vault_asset_amounts = vec![5000];

    let vault_asset_id = prepare_vault_asset(context, vault_asset_amount, vault_asset_amounts)?;

    let vault_parameters = AssetAuthVaultParameters::new(
        vault_asset_id,
        keeper_auth_asset_id,
        supplier_auth_asset_id,
        1,
        false,
        with_supplier_asset_burn,
        *context.get_network(),
    );

    let asset_auth_vault = setup_asset_auth_vault(context, vault_parameters)?;

    Ok((asset_auth_vault, vault_parameters))
}

#[simplex::test]
fn final_supply_fails_when_vault_already_finalized(
    context: simplex::TestContext,
) -> anyhow::Result<()> {
    let provider = context.get_default_provider();
    let signer = context.get_default_signer();

    let (asset_auth_vault, vault_parameters) =
        default_final_vault_supplying_setup(&context, false)?;

    let finalized_asset_auth_vault = final_supply(&context, &asset_auth_vault, 300)?;

    let asset_auth_vault_utxo = provider
        .fetch_scripthash_utxos(&finalized_asset_auth_vault.get_script_pubkey())?[0]
        .clone();

    let utxo_to_supply = signer.get_utxos_asset(vault_parameters.vault_asset_id)?[0].clone();
    let amount_to_supply = utxo_to_supply.explicit_amount();

    let supplier_auth_utxo = signer.get_utxos_asset(vault_parameters.supplier_asset_id)?[0].clone();

    let mut ft = FinalTransaction::new();

    ft.add_output(PartialOutput::new(
        signer.get_address().script_pubkey(),
        supplier_auth_utxo.explicit_amount(),
        supplier_auth_utxo.explicit_asset(),
    ));
    ft.add_input(
        PartialInput::new(supplier_auth_utxo),
        RequiredSignature::NativeEcdsa,
    );

    finalized_asset_auth_vault.attach_final_supplying(
        &mut ft,
        asset_auth_vault_utxo,
        0,
        0,
        amount_to_supply,
    );

    ft.add_input(
        PartialInput::new(utxo_to_supply),
        RequiredSignature::NativeEcdsa,
    );

    let result = signer.finalize(&ft);

    assert!(
        result.is_err(),
        "expected finalize to fail, but it succeeded"
    );

    Ok(())
}

#[simplex::test]
fn final_supply_fails_when_auth_utxo_is_invalid(
    context: simplex::TestContext,
) -> anyhow::Result<()> {
    let provider = context.get_default_provider();
    let signer = context.get_default_signer();

    let (asset_auth_vault, vault_parameters) =
        default_final_vault_supplying_setup(&context, false)?;

    let asset_auth_vault_utxo =
        provider.fetch_scripthash_utxos(&asset_auth_vault.get_script_pubkey())?[0].clone();

    let invalid_auth_index_pairs = [(0, 1), (1, 0), (1, 1)];

    for auth_index_pair in invalid_auth_index_pairs {
        let utxo_to_supply = signer.get_utxos_asset(vault_parameters.vault_asset_id)?[0].clone();
        let amount_to_supply = utxo_to_supply.explicit_amount();

        let supplier_auth_utxo =
            signer.get_utxos_asset(vault_parameters.supplier_asset_id)?[0].clone();

        let mut ft = FinalTransaction::new();

        ft.add_output(PartialOutput::new(
            signer.get_address().script_pubkey(),
            supplier_auth_utxo.explicit_amount(),
            supplier_auth_utxo.explicit_asset(),
        ));
        ft.add_input(
            PartialInput::new(supplier_auth_utxo),
            RequiredSignature::NativeEcdsa,
        );
        ft.add_input(
            PartialInput::new(utxo_to_supply),
            RequiredSignature::NativeEcdsa,
        );

        asset_auth_vault.attach_final_supplying(
            &mut ft,
            asset_auth_vault_utxo.clone(),
            auth_index_pair.0,
            auth_index_pair.1,
            amount_to_supply,
        );

        let result = signer.finalize(&ft);

        assert!(
            result.is_err(),
            "expected finalize to fail, but it succeeded"
        );
    }

    Ok(())
}

#[simplex::test]
fn final_supply_fails_when_auth_utxo_burned_but_burn_flag_was_not_set(
    context: simplex::TestContext,
) -> anyhow::Result<()> {
    let provider = context.get_default_provider();
    let signer = context.get_default_signer();

    let (asset_auth_vault, vault_parameters) =
        default_final_vault_supplying_setup(&context, false)?;

    let asset_auth_vault_utxo =
        provider.fetch_scripthash_utxos(&asset_auth_vault.get_script_pubkey())?[0].clone();

    let utxo_to_supply = signer.get_utxos_asset(vault_parameters.vault_asset_id)?[0].clone();
    let amount_to_supply = utxo_to_supply.explicit_amount();

    let supplier_auth_utxo = signer.get_utxos_asset(vault_parameters.supplier_asset_id)?[0].clone();

    let mut ft = FinalTransaction::new();

    ft.add_output(PartialOutput::new(
        Script::new_op_return(b"burn"),
        supplier_auth_utxo.explicit_amount(),
        supplier_auth_utxo.explicit_asset(),
    ));
    ft.add_input(
        PartialInput::new(supplier_auth_utxo),
        RequiredSignature::NativeEcdsa,
    );

    asset_auth_vault.attach_final_supplying(&mut ft, asset_auth_vault_utxo, 0, 0, amount_to_supply);

    ft.add_input(
        PartialInput::new(utxo_to_supply),
        RequiredSignature::NativeEcdsa,
    );

    let result = signer.finalize(&ft);

    assert!(
        result.is_err(),
        "expected finalize to fail, but it succeeded"
    );

    Ok(())
}

#[simplex::test]
fn final_supply_fails_when_auth_utxo_was_not_burned_but_burn_flag_was_set(
    context: simplex::TestContext,
) -> anyhow::Result<()> {
    let provider = context.get_default_provider();
    let signer = context.get_default_signer();

    let (asset_auth_vault, vault_parameters) = default_final_vault_supplying_setup(&context, true)?;

    let asset_auth_vault_utxo =
        provider.fetch_scripthash_utxos(&asset_auth_vault.get_script_pubkey())?[0].clone();

    let utxo_to_supply = signer.get_utxos_asset(vault_parameters.vault_asset_id)?[0].clone();
    let amount_to_supply = utxo_to_supply.explicit_amount();

    let supplier_auth_utxo = signer.get_utxos_asset(vault_parameters.supplier_asset_id)?[0].clone();

    let mut ft = FinalTransaction::new();

    ft.add_output(PartialOutput::new(
        signer.get_address().script_pubkey(),
        supplier_auth_utxo.explicit_amount(),
        supplier_auth_utxo.explicit_asset(),
    ));
    ft.add_input(
        PartialInput::new(supplier_auth_utxo),
        RequiredSignature::NativeEcdsa,
    );

    asset_auth_vault.attach_final_supplying(&mut ft, asset_auth_vault_utxo, 0, 0, amount_to_supply);

    ft.add_input(
        PartialInput::new(utxo_to_supply),
        RequiredSignature::NativeEcdsa,
    );

    let result = signer.finalize(&ft);

    assert!(
        result.is_err(),
        "expected finalize to fail, but it succeeded"
    );

    Ok(())
}
