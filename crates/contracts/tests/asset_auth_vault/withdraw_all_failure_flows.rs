use lending_contracts::programs::asset_auth_vault::{
    ActiveAssetAuthVault, ActiveAssetAuthVaultParameters, FinalizedAssetAuthVault,
    FinalizedAssetAuthVaultParameters,
};
use lending_contracts::programs::program::SimplexProgram;

use simplex::signer::Signer;
use simplex::simplicityhl::elements::Script;
use simplex::transaction::{FinalTransaction, PartialInput, PartialOutput, RequiredSignature};

use super::setup::{
    final_supply, fund_keeper, issue_auth_assets, prepare_vault_asset, setup_asset_auth_vault,
};

fn setup_non_finalized_vault(
    context: &simplex::TestContext,
    keeper: &Signer,
    vault_asset_amounts: Vec<u64>,
    keeper_auth_asset_amount: u64,
    with_keeper_asset_burn: bool,
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
        with_keeper_asset_burn,
        with_supplier_asset_burn: false,
        network: *context.get_network(),
    };

    let asset_auth_vault = setup_asset_auth_vault(context, vault_parameters)?;
    let asset_auth_vault_parameters = *asset_auth_vault.get_parameters();

    fund_keeper(context, keeper, vault_parameters.keeper_asset_id)?;

    Ok((asset_auth_vault, asset_auth_vault_parameters))
}

fn default_vault_withdrawing_all_setup(
    context: &simplex::TestContext,
    keeper: &Signer,
    vault_asset_amounts: Vec<u64>,
    keeper_auth_asset_amount: u64,
    with_keeper_asset_burn: bool,
) -> anyhow::Result<(FinalizedAssetAuthVault, FinalizedAssetAuthVaultParameters)> {
    let (asset_auth_vault, vault_parameters) = setup_non_finalized_vault(
        context,
        keeper,
        vault_asset_amounts,
        keeper_auth_asset_amount,
        with_keeper_asset_burn,
    )?;

    let finalized_vault = final_supply(context, &asset_auth_vault, 300)?;

    Ok((finalized_vault, vault_parameters.into()))
}

#[simplex::test]
fn withdraw_all_fails_when_vault_is_not_finalized(
    context: simplex::TestContext,
) -> anyhow::Result<()> {
    let provider = context.get_default_provider();
    let keeper = context.random_signer();

    let (asset_auth_vault, vault_parameters) =
        setup_non_finalized_vault(&context, &keeper, vec![5000], 1, false)?;

    let asset_auth_vault_utxo =
        provider.fetch_scripthash_utxos(&asset_auth_vault.get_script_pubkey())?[0].clone();

    let current_vault_balance = asset_auth_vault_utxo.explicit_amount();

    let finalized_vault = FinalizedAssetAuthVault::new(vault_parameters.into());

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

    finalized_vault.attach_withdrawing_all(&mut ft, asset_auth_vault_utxo, 0, 0);

    ft.add_output(PartialOutput::new(
        keeper.get_address().script_pubkey(),
        current_vault_balance,
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
fn withdraw_all_fails_when_auth_utxo_is_invalid(
    context: simplex::TestContext,
) -> anyhow::Result<()> {
    let provider = context.get_default_provider();
    let keeper = context.random_signer();

    let (asset_auth_vault, vault_parameters) =
        default_vault_withdrawing_all_setup(&context, &keeper, vec![5000], 1, true)?;

    let asset_auth_vault_utxo =
        provider.fetch_scripthash_utxos(&asset_auth_vault.get_script_pubkey())?[0].clone();

    let current_vault_balance = asset_auth_vault_utxo.explicit_amount();

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

        asset_auth_vault.attach_withdrawing_all(
            &mut ft,
            asset_auth_vault_utxo.clone(),
            auth_index_pair.0,
            auth_index_pair.1,
        );

        ft.add_output(PartialOutput::new(
            keeper.get_address().script_pubkey(),
            current_vault_balance,
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
fn withdraw_all_fails_when_auth_utxo_has_less_than_minimum_amount(
    context: simplex::TestContext,
) -> anyhow::Result<()> {
    let provider = context.get_default_provider();
    let keeper = context.random_signer();

    let keeper_auth_asset_amount = 1000;
    let (asset_auth_vault, vault_parameters) = default_vault_withdrawing_all_setup(
        &context,
        &keeper,
        vec![5000],
        keeper_auth_asset_amount,
        false,
    )?;

    let asset_auth_vault_utxo =
        provider.fetch_scripthash_utxos(&asset_auth_vault.get_script_pubkey())?[0].clone();

    let current_vault_balance = asset_auth_vault_utxo.explicit_amount();

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

    asset_auth_vault.attach_withdrawing_all(&mut ft, asset_auth_vault_utxo.clone(), 0, 1);

    ft.add_output(PartialOutput::new(
        keeper.get_address().script_pubkey(),
        current_vault_balance,
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
fn withdraw_all_fails_when_auth_utxo_burned_but_burn_flag_was_not_set(
    context: simplex::TestContext,
) -> anyhow::Result<()> {
    let provider = context.get_default_provider();
    let keeper = context.random_signer();

    let (asset_auth_vault, vault_parameters) =
        default_vault_withdrawing_all_setup(&context, &keeper, vec![5000], 1, false)?;

    let asset_auth_vault_utxo =
        provider.fetch_scripthash_utxos(&asset_auth_vault.get_script_pubkey())?[0].clone();

    let current_vault_balance = asset_auth_vault_utxo.explicit_amount();

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

    asset_auth_vault.attach_withdrawing_all(&mut ft, asset_auth_vault_utxo.clone(), 0, 1);

    ft.add_output(PartialOutput::new(
        keeper.get_address().script_pubkey(),
        current_vault_balance,
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
fn withdraw_all_fails_when_auth_utxo_was_not_burned_but_burn_flag_was_set(
    context: simplex::TestContext,
) -> anyhow::Result<()> {
    let provider = context.get_default_provider();
    let keeper = context.random_signer();

    let (asset_auth_vault, vault_parameters) =
        default_vault_withdrawing_all_setup(&context, &keeper, vec![5000], 1, true)?;

    let asset_auth_vault_utxo =
        provider.fetch_scripthash_utxos(&asset_auth_vault.get_script_pubkey())?[0].clone();

    let current_vault_balance = asset_auth_vault_utxo.explicit_amount();

    let keeper_auth_utxo = keeper.get_utxos_asset(vault_parameters.keeper_asset_id)?[0].clone();

    let mut ft = FinalTransaction::new();

    ft.add_input(
        PartialInput::new(keeper_auth_utxo.clone()),
        RequiredSignature::NativeEcdsa,
    );
    ft.add_output(PartialOutput::new(
        keeper.get_address().script_pubkey(),
        keeper_auth_utxo.explicit_amount(),
        vault_parameters.keeper_asset_id,
    ));

    asset_auth_vault.attach_withdrawing_all(&mut ft, asset_auth_vault_utxo.clone(), 0, 1);

    ft.add_output(PartialOutput::new(
        keeper.get_address().script_pubkey(),
        current_vault_balance,
        vault_parameters.vault_asset_id,
    ));

    let result = keeper.finalize(&ft);

    assert!(
        result.is_err(),
        "expected finalize to fail, but it succeeded"
    );

    Ok(())
}
