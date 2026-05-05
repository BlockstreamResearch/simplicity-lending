use lending_contracts::programs::asset_auth_vault::{
    ActiveAssetAuthVault, ActiveAssetAuthVaultParameters, FinalizedAssetAuthVaultParameters,
};
use lending_contracts::programs::program::SimplexProgram;

use simplex::signer::Signer;
use simplex::simplicityhl::elements::Script;
use simplex::transaction::{FinalTransaction, PartialInput, PartialOutput, RequiredSignature};

use super::setup::{
    final_supply, fund_keeper, issue_auth_assets, prepare_vault_asset, setup_asset_auth_vault,
    supply,
};

fn default_vault_withdrawing_setup(
    context: &simplex::TestContext,
    keeper: &Signer,
    vault_asset_amounts: Vec<u64>,
    keeper_auth_asset_amount: u64,
    amount_to_supply: u64,
) -> anyhow::Result<(ActiveAssetAuthVault, ActiveAssetAuthVaultParameters)> {
    let (supplier_asset_id, keeper_asset_id) =
        issue_auth_assets(context, 1, keeper_auth_asset_amount)?;

    let vault_asset_amount = 1_000_000;
    let vault_asset_id = prepare_vault_asset(context, vault_asset_amount, vault_asset_amounts)?;

    let vault_parameters = FinalizedAssetAuthVaultParameters {
        vault_asset_id,
        keeper_asset_id,
        supplier_asset_id,
        keeper_min_asset_amount: keeper_auth_asset_amount,
        with_keeper_asset_burn: false,
        with_supplier_asset_burn: false,
        network: *context.get_network(),
    };

    let asset_auth_vault = setup_asset_auth_vault(context, vault_parameters)?;
    let active_vault_parameters = *asset_auth_vault.get_parameters();

    supply(context, &asset_auth_vault, amount_to_supply)?;

    fund_keeper(context, keeper, vault_parameters.keeper_asset_id)?;

    Ok((asset_auth_vault, active_vault_parameters))
}

#[simplex::test]
fn partial_withdraw_fails_when_vault_already_finalized(
    context: simplex::TestContext,
) -> anyhow::Result<()> {
    let provider = context.get_default_provider();
    let keeper = context.random_signer();

    let (asset_auth_vault, vault_parameters) =
        default_vault_withdrawing_setup(&context, &keeper, vec![5000], 1, 1000)?;

    let finalized_asset_auth_vault = final_supply(&context, &asset_auth_vault, 300)?;

    let asset_auth_vault_utxo = provider
        .fetch_scripthash_utxos(&finalized_asset_auth_vault.get_script_pubkey())?[0]
        .clone();

    let current_vault_balance = asset_auth_vault_utxo.explicit_amount();
    let amount_to_withdraw = current_vault_balance / 2;

    let keeper_auth_utxo = keeper.get_utxos_asset(vault_parameters.keeper_asset_id)?[0].clone();

    let mut ft = FinalTransaction::new();

    ft.add_input(
        PartialInput::new(keeper_auth_utxo.clone()),
        RequiredSignature::NativeEcdsa,
    );
    ft.add_output(PartialOutput::new(
        keeper.get_address().script_pubkey(),
        keeper_auth_utxo.explicit_amount(),
        keeper_auth_utxo.explicit_asset(),
    ));

    asset_auth_vault.attach_partial_withdrawing(
        &mut ft,
        asset_auth_vault_utxo,
        0,
        0,
        amount_to_withdraw,
    );

    ft.add_output(PartialOutput::new(
        keeper.get_address().script_pubkey(),
        amount_to_withdraw,
        vault_parameters.vault_asset_id,
    ));

    let result = keeper.finalize(&ft);

    assert!(
        result.is_err(),
        "expected finalize to fail, but it succeeded"
    );

    Ok(())
}

#[simplex::test]
fn partial_withdraw_fails_when_auth_utxo_is_invalid(
    context: simplex::TestContext,
) -> anyhow::Result<()> {
    let provider = context.get_default_provider();
    let keeper = context.random_signer();

    let (asset_auth_vault, vault_parameters) =
        default_vault_withdrawing_setup(&context, &keeper, vec![5000], 1, 1000)?;

    let asset_auth_vault_utxo =
        provider.fetch_scripthash_utxos(&asset_auth_vault.get_script_pubkey())?[0].clone();

    let current_vault_balance = asset_auth_vault_utxo.explicit_amount();
    let amount_to_withdraw = current_vault_balance / 2;

    let invalid_auth_index_pairs = [(0, 1), (1, 0), (1, 1)];

    for auth_index_pair in invalid_auth_index_pairs {
        let keeper_auth_utxo = keeper.get_utxos_asset(vault_parameters.keeper_asset_id)?[0].clone();

        let mut ft = FinalTransaction::new();

        ft.add_input(
            PartialInput::new(keeper_auth_utxo.clone()),
            RequiredSignature::NativeEcdsa,
        );
        ft.add_output(PartialOutput::new(
            keeper.get_address().script_pubkey(),
            keeper_auth_utxo.explicit_amount(),
            keeper_auth_utxo.explicit_asset(),
        ));

        asset_auth_vault.attach_partial_withdrawing(
            &mut ft,
            asset_auth_vault_utxo.clone(),
            auth_index_pair.0,
            auth_index_pair.1,
            amount_to_withdraw,
        );

        ft.add_output(PartialOutput::new(
            keeper.get_address().script_pubkey(),
            amount_to_withdraw,
            vault_parameters.vault_asset_id,
        ));

        let result = keeper.finalize(&ft);

        assert!(
            result.is_err(),
            "expected finalize to fail, but it succeeded"
        );
    }

    Ok(())
}

#[simplex::test]
fn partial_withdraw_fails_when_auth_utxo_has_less_than_minimum_amount(
    context: simplex::TestContext,
) -> anyhow::Result<()> {
    let provider = context.get_default_provider();
    let keeper = context.random_signer();

    let keeper_auth_asset_amount = 1000;
    let (asset_auth_vault, vault_parameters) = default_vault_withdrawing_setup(
        &context,
        &keeper,
        vec![5000],
        keeper_auth_asset_amount,
        1000,
    )?;

    let asset_auth_vault_utxo =
        provider.fetch_scripthash_utxos(&asset_auth_vault.get_script_pubkey())?[0].clone();

    let current_vault_balance = asset_auth_vault_utxo.explicit_amount();
    let amount_to_withdraw = current_vault_balance / 2;

    let keeper_auth_utxo = keeper.get_utxos_asset(vault_parameters.keeper_asset_id)?[0].clone();

    let mut ft = FinalTransaction::new();

    ft.add_input(
        PartialInput::new(keeper_auth_utxo.clone()),
        RequiredSignature::NativeEcdsa,
    );
    ft.add_output(PartialOutput::new(
        keeper.get_address().script_pubkey(),
        keeper_auth_asset_amount / 2,
        vault_parameters.keeper_asset_id,
    ));
    ft.add_output(PartialOutput::new(
        keeper.get_address().script_pubkey(),
        keeper_auth_asset_amount / 2,
        vault_parameters.keeper_asset_id,
    ));

    asset_auth_vault.attach_partial_withdrawing(
        &mut ft,
        asset_auth_vault_utxo.clone(),
        0,
        1,
        amount_to_withdraw,
    );

    ft.add_output(PartialOutput::new(
        keeper.get_address().script_pubkey(),
        amount_to_withdraw,
        vault_parameters.vault_asset_id,
    ));

    let result = keeper.finalize(&ft);

    assert!(
        result.is_err(),
        "expected finalize to fail, but it succeeded"
    );

    Ok(())
}

#[simplex::test]
fn partial_withdraw_fails_when_auth_utxo_burned_but_burn_flag_was_not_set(
    context: simplex::TestContext,
) -> anyhow::Result<()> {
    let provider = context.get_default_provider();
    let keeper = context.random_signer();

    let (asset_auth_vault, vault_parameters) =
        default_vault_withdrawing_setup(&context, &keeper, vec![5000], 1, 1000)?;

    let asset_auth_vault_utxo =
        provider.fetch_scripthash_utxos(&asset_auth_vault.get_script_pubkey())?[0].clone();

    let current_vault_balance = asset_auth_vault_utxo.explicit_amount();
    let amount_to_withdraw = current_vault_balance / 2;

    let keeper_auth_utxo = keeper.get_utxos_asset(vault_parameters.keeper_asset_id)?[0].clone();

    let mut ft = FinalTransaction::new();

    ft.add_input(
        PartialInput::new(keeper_auth_utxo.clone()),
        RequiredSignature::NativeEcdsa,
    );
    ft.add_output(PartialOutput::new(
        Script::new_op_return(b"burn"),
        keeper_auth_utxo.explicit_amount(),
        vault_parameters.keeper_asset_id,
    ));

    asset_auth_vault.attach_partial_withdrawing(
        &mut ft,
        asset_auth_vault_utxo.clone(),
        0,
        1,
        amount_to_withdraw,
    );

    ft.add_output(PartialOutput::new(
        keeper.get_address().script_pubkey(),
        amount_to_withdraw,
        vault_parameters.vault_asset_id,
    ));

    let result = keeper.finalize(&ft);

    assert!(
        result.is_err(),
        "expected finalize to fail, but it succeeded"
    );

    Ok(())
}
