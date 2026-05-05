use lending_contracts::programs::asset_auth_vault::{
    ActiveAssetAuthVault, ActiveAssetAuthVaultParameters, FinalizedAssetAuthVaultParameters,
};
use lending_contracts::programs::program::SimplexProgram;

use simplex::simplicityhl::elements::Script;
use simplex::transaction::{FinalTransaction, PartialInput, PartialOutput, RequiredSignature};

use super::common::tx_steps::finalize_and_broadcast;
use super::setup::{
    check_vault_amount, issue_auth_assets, make_confidential, prepare_vault_asset,
    setup_asset_auth_vault,
};

fn default_final_vault_supplying_setup(
    context: &simplex::TestContext,
    with_supplier_asset_burn: bool,
) -> anyhow::Result<(ActiveAssetAuthVault, ActiveAssetAuthVaultParameters)> {
    let (supplier_asset_id, keeper_asset_id) = issue_auth_assets(context, 1, 1)?;

    let vault_asset_amount = 1_000_000;
    let vault_asset_amounts = vec![5000];

    let vault_asset_id = prepare_vault_asset(context, vault_asset_amount, vault_asset_amounts)?;

    let vault_parameters = FinalizedAssetAuthVaultParameters {
        vault_asset_id,
        keeper_asset_id,
        supplier_asset_id,
        keeper_min_asset_amount: 1,
        with_keeper_asset_burn: false,
        with_supplier_asset_burn,
        network: *context.get_network(),
    };

    let asset_auth_vault = setup_asset_auth_vault(context, vault_parameters)?;
    let active_vault_parameters = *asset_auth_vault.get_parameters();

    Ok((asset_auth_vault, active_vault_parameters))
}

#[simplex::test]
fn final_supply_succeeds_with_explicit_input_without_auth_burn(
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
        signer.get_address().script_pubkey(),
        supplier_auth_utxo.explicit_amount(),
        supplier_auth_utxo.explicit_asset(),
    ));
    ft.add_input(
        PartialInput::new(supplier_auth_utxo),
        RequiredSignature::NativeEcdsa,
    );

    let expected_vault_balance = asset_auth_vault_utxo.explicit_amount() + amount_to_supply;

    let finalized_vault = asset_auth_vault.attach_final_supplying(
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

    let txid = finalize_and_broadcast(&context, &ft)?;
    provider.wait(&txid)?;

    check_vault_amount(&context, &finalized_vault, expected_vault_balance)?;

    Ok(())
}

#[simplex::test]
fn final_supply_succeeds_with_explicit_input_and_auth_burn(
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
        Script::new_op_return(b"burn"),
        supplier_auth_utxo.explicit_amount(),
        supplier_auth_utxo.explicit_asset(),
    ));
    ft.add_input(
        PartialInput::new(supplier_auth_utxo),
        RequiredSignature::NativeEcdsa,
    );

    let expected_vault_balance = asset_auth_vault_utxo.explicit_amount() + amount_to_supply;

    let finalized_vault = asset_auth_vault.attach_final_supplying(
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

    let txid = finalize_and_broadcast(&context, &ft)?;
    provider.wait(&txid)?;

    check_vault_amount(&context, &finalized_vault, expected_vault_balance)?;

    Ok(())
}

#[simplex::test]
fn final_supply_succeeds_with_confidential_input(
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

    let finalized_vault = asset_auth_vault.attach_final_supplying(
        &mut ft,
        asset_auth_vault_utxo,
        1,
        1,
        amount_to_supply,
    );

    ft.add_output(PartialOutput::new(
        signer.get_address().script_pubkey(),
        supplier_auth_utxo.explicit_amount(),
        supplier_auth_utxo.explicit_asset(),
    ));

    let txid = finalize_and_broadcast(&context, &ft)?;
    provider.wait(&txid)?;

    check_vault_amount(&context, &finalized_vault, expected_vault_balance)?;

    Ok(())
}
