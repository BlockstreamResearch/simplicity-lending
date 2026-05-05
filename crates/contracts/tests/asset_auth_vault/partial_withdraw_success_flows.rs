use lending_contracts::programs::asset_auth_vault::{
    ActiveAssetAuthVault, ActiveAssetAuthVaultParameters, FinalizedAssetAuthVaultParameters,
};
use lending_contracts::programs::program::SimplexProgram;

use simplex::signer::Signer;
use simplex::transaction::{FinalTransaction, PartialInput, PartialOutput, RequiredSignature};

use super::setup::{
    check_vault_amount, fund_keeper, issue_auth_assets, prepare_vault_asset,
    setup_asset_auth_vault, supply,
};

fn default_vault_withdrawing_setup(
    context: &simplex::TestContext,
    keeper: &Signer,
    vault_asset_amounts: Vec<u64>,
    amount_to_supply: u64,
) -> anyhow::Result<(ActiveAssetAuthVault, ActiveAssetAuthVaultParameters)> {
    let (supplier_asset_id, keeper_asset_id) = issue_auth_assets(context, 1, 1)?;

    let vault_asset_amount = 1_000_000;
    let vault_asset_id = prepare_vault_asset(context, vault_asset_amount, vault_asset_amounts)?;

    let vault_parameters = FinalizedAssetAuthVaultParameters {
        vault_asset_id,
        keeper_asset_id,
        supplier_asset_id,
        keeper_min_asset_amount: 1,
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

fn withdraw(
    context: &simplex::TestContext,
    keeper: &Signer,
    asset_auth_vault: &ActiveAssetAuthVault,
    amount_to_withdraw: u64,
) -> anyhow::Result<()> {
    let provider = context.get_default_provider();

    let vault_parameters = asset_auth_vault.get_parameters();

    let asset_auth_vault_utxo =
        provider.fetch_scripthash_utxos(&asset_auth_vault.get_script_pubkey())?[0].clone();

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

    let txid = keeper.broadcast(&ft)?;
    provider.wait(&txid)?;

    Ok(())
}

#[simplex::test]
fn partial_withdraw_succeeds_with_one_explicit_output(
    context: simplex::TestContext,
) -> anyhow::Result<()> {
    let provider = context.get_default_provider();
    let keeper = context.random_signer();

    let (asset_auth_vault, vault_parameters) =
        default_vault_withdrawing_setup(&context, &keeper, vec![5000], 1000)?;

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

    let txid = keeper.broadcast(&ft)?;
    provider.wait(&txid)?;

    check_vault_amount(
        &context,
        &asset_auth_vault,
        current_vault_balance - amount_to_withdraw,
    )?;

    Ok(())
}

#[simplex::test]
fn partial_withdraw_succeeds_with_several_explicit_outputs(
    context: simplex::TestContext,
) -> anyhow::Result<()> {
    let provider = context.get_default_provider();
    let keeper = context.random_signer();

    let (asset_auth_vault, vault_parameters) =
        default_vault_withdrawing_setup(&context, &keeper, vec![5000], 1000)?;

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
        amount_to_withdraw / 2,
        vault_parameters.vault_asset_id,
    ));
    ft.add_output(PartialOutput::new(
        keeper.get_address().script_pubkey(),
        amount_to_withdraw / 2,
        vault_parameters.vault_asset_id,
    ));

    let txid = keeper.broadcast(&ft)?;
    provider.wait(&txid)?;

    check_vault_amount(
        &context,
        &asset_auth_vault,
        current_vault_balance - amount_to_withdraw,
    )?;

    Ok(())
}

#[simplex::test]
fn partial_withdraw_succeeds_with_several_confidential_outputs(
    context: simplex::TestContext,
) -> anyhow::Result<()> {
    let provider = context.get_default_provider();
    let keeper = context.random_signer();

    let (asset_auth_vault, vault_parameters) =
        default_vault_withdrawing_setup(&context, &keeper, vec![5000], 1000)?;

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

    ft.add_output(
        PartialOutput::new(
            keeper.get_confidential_address().script_pubkey(),
            amount_to_withdraw / 2,
            vault_parameters.vault_asset_id,
        )
        .with_blinding_key(keeper.get_blinding_public_key()),
    );
    ft.add_output(
        PartialOutput::new(
            keeper.get_confidential_address().script_pubkey(),
            amount_to_withdraw / 2,
            vault_parameters.vault_asset_id,
        )
        .with_blinding_key(keeper.get_blinding_public_key()),
    );

    let txid = keeper.broadcast(&ft)?;
    provider.wait(&txid)?;

    check_vault_amount(
        &context,
        &asset_auth_vault,
        current_vault_balance - amount_to_withdraw,
    )?;

    Ok(())
}

#[simplex::test]
fn partial_withdraw_succeeds_several_times(context: simplex::TestContext) -> anyhow::Result<()> {
    let provider = context.get_default_provider();
    let keeper = context.random_signer();

    let (asset_auth_vault, _) =
        default_vault_withdrawing_setup(&context, &keeper, vec![5000], 1000)?;

    let asset_auth_vault_utxo =
        provider.fetch_scripthash_utxos(&asset_auth_vault.get_script_pubkey())?[0].clone();

    let current_vault_balance = asset_auth_vault_utxo.explicit_amount();
    let amount_to_withdraw = current_vault_balance / 2;

    withdraw(&context, &keeper, &asset_auth_vault, amount_to_withdraw)?;

    check_vault_amount(
        &context,
        &asset_auth_vault,
        current_vault_balance - amount_to_withdraw,
    )?;

    let asset_auth_vault_utxo =
        provider.fetch_scripthash_utxos(&asset_auth_vault.get_script_pubkey())?[0].clone();

    let current_vault_balance = asset_auth_vault_utxo.explicit_amount();
    let amount_to_withdraw = current_vault_balance / 2;

    withdraw(&context, &keeper, &asset_auth_vault, amount_to_withdraw)?;

    check_vault_amount(
        &context,
        &asset_auth_vault,
        current_vault_balance - amount_to_withdraw,
    )?;

    Ok(())
}
