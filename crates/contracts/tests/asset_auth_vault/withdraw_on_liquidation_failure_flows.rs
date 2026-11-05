use lending_contracts::programs::asset_auth_vault::{
    AssetAuthVault, AssetAuthVaultParameters, AssetAuthVaultWitnessBranch,
};
use lending_contracts::programs::program::SimplexProgram;

use simplex::signer::Signer;
use simplex::simplicityhl::elements::{LockTime, Script, Sequence};
use simplex::transaction::{FinalTransaction, NativeSignature, PartialInput, PartialOutput, UTXO};

use super::setup::{final_supply, setup_withdrawable_on_liquidation_vault};

fn keeper_burn_output(keeper_auth_utxo: &UTXO) -> PartialOutput {
    PartialOutput::new(
        Script::new_op_return(b"burn"),
        keeper_auth_utxo.explicit_amount(),
        keeper_auth_utxo.explicit_asset(),
    )
}

fn finalize_withdraw_on_liquidation(
    keeper: &Signer,
    asset_auth_vault: &AssetAuthVault,
    vault_parameters: &AssetAuthVaultParameters,
    asset_auth_vault_utxo: UTXO,
    keeper_auth_utxo: UTXO,
    keeper_output: PartialOutput,
) -> bool {
    let current_vault_balance = asset_auth_vault_utxo.explicit_amount();

    let mut ft = FinalTransaction::new();

    ft.add_input(
        PartialInput::new(keeper_auth_utxo),
        Some(NativeSignature::Ecdsa),
    );
    ft.add_output(keeper_output);

    asset_auth_vault.attach_withdrawing_on_liquidation(&mut ft, asset_auth_vault_utxo, 0, 0);

    ft.add_output(PartialOutput::new(
        keeper.get_address().script_pubkey(),
        current_vault_balance,
        vault_parameters.vault_asset_id,
    ));

    keeper.finalize(&ft).is_ok()
}

#[simplex::test]
fn withdraw_on_liquidation_fails_when_locktime_is_below_liquidation_height(
    context: simplex::TestContext,
) -> anyhow::Result<()> {
    let provider = context.get_default_provider();
    let keeper = context.random_signer();

    let liquidation_height = provider.fetch_tip_height()? + 20;

    let (asset_auth_vault, vault_parameters) =
        setup_withdrawable_on_liquidation_vault(&context, &keeper, liquidation_height, true)?;

    // Mine past the height so only the covenant's own locktime check can reject the spend.
    context
        .get_network_utils()
        .mine_until_height(u64::from(liquidation_height) + 1)?;

    let asset_auth_vault_utxo =
        provider.fetch_scripthash_utxos(&asset_auth_vault.get_script_pubkey())?[0].clone();

    let current_vault_balance = asset_auth_vault_utxo.explicit_amount();
    let already_supplied = asset_auth_vault.get_already_supplied_amount();

    let keeper_auth_utxo = keeper.get_utxos_asset(vault_parameters.keeper_asset_id)?[0].clone();

    let mut ft = FinalTransaction::new();

    ft.add_input(
        PartialInput::new(keeper_auth_utxo.clone()),
        Some(NativeSignature::Ecdsa),
    );
    ft.add_output(keeper_burn_output(&keeper_auth_utxo));

    let early_locktime = LockTime::from_height(liquidation_height - 1)?;
    let vault_input = PartialInput::new(asset_auth_vault_utxo)
        .with_sequence(Sequence::ENABLE_LOCKTIME_NO_RBF)
        .with_locktime(early_locktime);

    asset_auth_vault.add_program_input_from_partial_input(
        &mut ft,
        vault_input,
        AssetAuthVaultWitnessBranch::WithdrawOnLiquidation {
            input_keeper_index: 0,
            output_keeper_index: 0,
            already_supplied,
        }
        .build_witness(),
    );

    ft.add_output(PartialOutput::new(
        keeper.get_address().script_pubkey(),
        current_vault_balance,
        vault_parameters.vault_asset_id,
    ));

    assert!(
        keeper.finalize(&ft).is_err(),
        "expected finalize to fail, but it succeeded"
    );

    Ok(())
}

#[simplex::test]
fn withdraw_on_liquidation_fails_when_keeper_asset_is_not_burned(
    context: simplex::TestContext,
) -> anyhow::Result<()> {
    let provider = context.get_default_provider();
    let keeper = context.random_signer();

    let liquidation_height = provider.fetch_tip_height()? + 20;

    let (asset_auth_vault, vault_parameters) =
        setup_withdrawable_on_liquidation_vault(&context, &keeper, liquidation_height, true)?;

    context
        .get_network_utils()
        .mine_until_height(u64::from(liquidation_height) + 1)?;

    let asset_auth_vault_utxo =
        provider.fetch_scripthash_utxos(&asset_auth_vault.get_script_pubkey())?[0].clone();

    let keeper_auth_utxo = keeper.get_utxos_asset(vault_parameters.keeper_asset_id)?[0].clone();

    let keeper_output = PartialOutput::new(
        keeper.get_address().script_pubkey(),
        keeper_auth_utxo.explicit_amount(),
        keeper_auth_utxo.explicit_asset(),
    );

    assert!(
        !finalize_withdraw_on_liquidation(
            &keeper,
            &asset_auth_vault,
            &vault_parameters,
            asset_auth_vault_utxo,
            keeper_auth_utxo,
            keeper_output,
        ),
        "expected finalize to fail, but it succeeded"
    );

    Ok(())
}

#[simplex::test]
fn withdraw_on_liquidation_fails_when_vault_keeper_is_not_burnable(
    context: simplex::TestContext,
) -> anyhow::Result<()> {
    let provider = context.get_default_provider();
    let keeper = context.random_signer();

    let liquidation_height = provider.fetch_tip_height()? + 20;

    let (asset_auth_vault, vault_parameters) =
        setup_withdrawable_on_liquidation_vault(&context, &keeper, liquidation_height, false)?;

    context
        .get_network_utils()
        .mine_until_height(u64::from(liquidation_height) + 1)?;

    let asset_auth_vault_utxo =
        provider.fetch_scripthash_utxos(&asset_auth_vault.get_script_pubkey())?[0].clone();

    let keeper_auth_utxo = keeper.get_utxos_asset(vault_parameters.keeper_asset_id)?[0].clone();
    let keeper_output = keeper_burn_output(&keeper_auth_utxo);

    assert!(
        !finalize_withdraw_on_liquidation(
            &keeper,
            &asset_auth_vault,
            &vault_parameters,
            asset_auth_vault_utxo,
            keeper_auth_utxo,
            keeper_output,
        ),
        "expected finalize to fail, but it succeeded"
    );

    Ok(())
}

#[simplex::test]
fn withdraw_on_liquidation_fails_when_auth_utxo_is_invalid(
    context: simplex::TestContext,
) -> anyhow::Result<()> {
    let provider = context.get_default_provider();
    let signer = context.get_default_signer();
    let keeper = context.random_signer();

    let liquidation_height = provider.fetch_tip_height()? + 20;

    let (asset_auth_vault, vault_parameters) =
        setup_withdrawable_on_liquidation_vault(&context, &keeper, liquidation_height, true)?;

    context
        .get_network_utils()
        .mine_until_height(u64::from(liquidation_height) + 1)?;

    let asset_auth_vault_utxo =
        provider.fetch_scripthash_utxos(&asset_auth_vault.get_script_pubkey())?[0].clone();

    let foreign_auth_utxo = signer.get_utxos_asset(vault_parameters.supplier_asset_id)?[0].clone();
    let keeper_output = keeper_burn_output(&foreign_auth_utxo);

    assert!(
        !finalize_withdraw_on_liquidation(
            signer,
            &asset_auth_vault,
            &vault_parameters,
            asset_auth_vault_utxo,
            foreign_auth_utxo,
            keeper_output,
        ),
        "expected finalize to fail, but it succeeded"
    );

    Ok(())
}

#[simplex::test]
fn withdraw_on_liquidation_fails_when_vault_is_finalized(
    context: simplex::TestContext,
) -> anyhow::Result<()> {
    let provider = context.get_default_provider();
    let keeper = context.random_signer();

    let liquidation_height = provider.fetch_tip_height()? + 20;

    let (mut asset_auth_vault, vault_parameters) =
        setup_withdrawable_on_liquidation_vault(&context, &keeper, liquidation_height, true)?;

    final_supply(&context, &mut asset_auth_vault)?;

    context
        .get_network_utils()
        .mine_until_height(u64::from(liquidation_height) + 1)?;

    let asset_auth_vault_utxo =
        provider.fetch_scripthash_utxos(&asset_auth_vault.get_script_pubkey())?[0].clone();

    let keeper_auth_utxo = keeper.get_utxos_asset(vault_parameters.keeper_asset_id)?[0].clone();
    let keeper_output = keeper_burn_output(&keeper_auth_utxo);

    assert!(
        !finalize_withdraw_on_liquidation(
            &keeper,
            &asset_auth_vault,
            &vault_parameters,
            asset_auth_vault_utxo,
            keeper_auth_utxo,
            keeper_output,
        ),
        "expected finalize to fail, but it succeeded"
    );

    Ok(())
}
