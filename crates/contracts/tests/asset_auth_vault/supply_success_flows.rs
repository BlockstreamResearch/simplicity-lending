use lending_contracts::programs::asset_auth_vault::{AssetAuthVault, AssetAuthVaultParameters};
use lending_contracts::programs::program::SimplexProgram;

use simplex::transaction::{FinalTransaction, PartialInput, PartialOutput, RequiredSignature};

use super::common::tx_steps::finalize_and_broadcast;
use super::setup::{
    check_vault_amount, issue_auth_assets, make_confidential, prepare_vault_asset,
    setup_asset_auth_vault,
};

fn default_vault_supplying_setup(
    context: &simplex::TestContext,
    vault_asset_amounts: Vec<u64>,
) -> anyhow::Result<(AssetAuthVault, AssetAuthVaultParameters)> {
    let (supplier_auth_asset_id, keeper_auth_asset_id) = issue_auth_assets(context, 1, 1)?;

    let vault_asset_amount = 1_000_000;
    let vault_asset_id = prepare_vault_asset(context, vault_asset_amount, vault_asset_amounts)?;

    let vault_parameters = AssetAuthVaultParameters::new(
        vault_asset_id,
        keeper_auth_asset_id,
        supplier_auth_asset_id,
        1,
        false,
        false,
        *context.get_network(),
    );

    let asset_auth_vault = setup_asset_auth_vault(context, vault_parameters)?;

    Ok((asset_auth_vault, vault_parameters))
}

#[simplex::test]
fn supplies_to_vault_with_explicit_input(context: simplex::TestContext) -> anyhow::Result<()> {
    let provider = context.get_default_provider();
    let signer = context.get_default_signer();

    let (asset_auth_vault, vault_parameters) = default_vault_supplying_setup(&context, vec![5000])?;

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

    let expected_vault_balance = asset_auth_vault_utxo.explicit_amount() + amount_to_supply;

    asset_auth_vault.attach_supplying(&mut ft, asset_auth_vault_utxo, 0, 0, amount_to_supply);

    ft.add_input(
        PartialInput::new(utxo_to_supply),
        RequiredSignature::NativeEcdsa,
    );

    let txid = finalize_and_broadcast(&context, &ft)?;
    provider.wait(&txid)?;

    check_vault_amount(&context, &asset_auth_vault, expected_vault_balance)?;

    Ok(())
}

#[simplex::test]
fn supplies_to_vault_with_several_explicit_inputs(
    context: simplex::TestContext,
) -> anyhow::Result<()> {
    let provider = context.get_default_provider();
    let signer = context.get_default_signer();

    let (asset_auth_vault, vault_parameters) =
        default_vault_supplying_setup(&context, vec![5000, 10000])?;

    let asset_auth_vault_utxo =
        provider.fetch_scripthash_utxos(&asset_auth_vault.get_script_pubkey())?[0].clone();

    let utxos_to_supply = signer.get_utxos_asset(vault_parameters.vault_asset_id)?;
    let first_utxo_to_supply = utxos_to_supply[0].clone();
    let second_utxo_to_supply = utxos_to_supply[1].clone();

    let change_amount = 300;
    let total_inputs_vault_asset_amount =
        first_utxo_to_supply.explicit_amount() + second_utxo_to_supply.explicit_amount();
    let amount_to_supply = total_inputs_vault_asset_amount - change_amount;

    let supplier_auth_utxo = signer.get_utxos_asset(vault_parameters.supplier_asset_id)?[0].clone();

    let mut ft = FinalTransaction::new();

    ft.add_input(
        PartialInput::new(supplier_auth_utxo.clone()),
        RequiredSignature::NativeEcdsa,
    );
    ft.add_input(
        PartialInput::new(first_utxo_to_supply),
        RequiredSignature::NativeEcdsa,
    );
    ft.add_input(
        PartialInput::new(second_utxo_to_supply),
        RequiredSignature::NativeEcdsa,
    );

    ft.add_output(PartialOutput::new(
        signer.get_address().script_pubkey(),
        supplier_auth_utxo.explicit_amount(),
        supplier_auth_utxo.explicit_asset(),
    ));

    let expected_vault_balance = asset_auth_vault_utxo.explicit_amount() + amount_to_supply;

    asset_auth_vault.attach_supplying(&mut ft, asset_auth_vault_utxo, 0, 0, amount_to_supply);

    ft.add_output(PartialOutput::new(
        signer.get_address().script_pubkey(),
        change_amount,
        vault_parameters.vault_asset_id,
    ));

    let txid = finalize_and_broadcast(&context, &ft)?;
    provider.wait(&txid)?;

    check_vault_amount(&context, &asset_auth_vault, expected_vault_balance)?;

    Ok(())
}

#[simplex::test]
fn supplies_to_vault_with_confidential_input(context: simplex::TestContext) -> anyhow::Result<()> {
    let provider = context.get_default_provider();
    let signer = context.get_default_signer();

    let (asset_auth_vault, vault_parameters) = default_vault_supplying_setup(&context, vec![5000])?;

    let asset_auth_vault_utxo =
        provider.fetch_scripthash_utxos(&asset_auth_vault.get_script_pubkey())?[0].clone();

    let utxo_to_supply = signer.get_utxos_asset(vault_parameters.vault_asset_id)?[0].clone();
    let amount_to_supply = utxo_to_supply.explicit_amount();

    make_confidential(&context, utxo_to_supply)?;

    let conf_utxo_to_supply = signer.get_utxos_asset(vault_parameters.vault_asset_id)?[0].clone();
    let supplier_auth_utxo = signer.get_utxos_asset(vault_parameters.supplier_asset_id)?[0].clone();

    let mut ft = FinalTransaction::new();

    ft.add_input(
        PartialInput::new(conf_utxo_to_supply),
        RequiredSignature::NativeEcdsa,
    );
    ft.add_input(
        PartialInput::new(supplier_auth_utxo.clone()),
        RequiredSignature::NativeEcdsa,
    );

    let expected_vault_balance = asset_auth_vault_utxo.explicit_amount() + amount_to_supply;

    asset_auth_vault.attach_supplying(&mut ft, asset_auth_vault_utxo, 1, 1, amount_to_supply);

    ft.add_output(PartialOutput::new(
        signer.get_address().script_pubkey(),
        supplier_auth_utxo.explicit_amount(),
        supplier_auth_utxo.explicit_asset(),
    ));

    let txid = finalize_and_broadcast(&context, &ft)?;
    provider.wait(&txid)?;

    check_vault_amount(&context, &asset_auth_vault, expected_vault_balance)?;

    Ok(())
}
