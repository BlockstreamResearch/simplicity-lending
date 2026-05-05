use lending_contracts::programs::asset_auth_vault::{
    FinalizedAssetAuthVault, FinalizedAssetAuthVaultParameters,
};
use lending_contracts::programs::program::SimplexProgram;

use simplex::signer::Signer;
use simplex::simplicityhl::elements::Script;
use simplex::transaction::{FinalTransaction, PartialInput, PartialOutput, RequiredSignature};

use super::setup::{
    final_supply, fund_keeper, issue_auth_assets, prepare_vault_asset, setup_asset_auth_vault,
};

fn default_vault_withdrawing_all_setup(
    context: &simplex::TestContext,
    keeper: &Signer,
    vault_asset_amounts: Vec<u64>,
    amount_to_supply: u64,
    with_keeper_asset_burn: bool,
) -> anyhow::Result<(FinalizedAssetAuthVault, FinalizedAssetAuthVaultParameters)> {
    let (supplier_asset_id, keeper_asset_id) = issue_auth_assets(context, 1, 1)?;

    let vault_asset_amount = 1_000_000;
    let vault_asset_id = prepare_vault_asset(context, vault_asset_amount, vault_asset_amounts)?;

    let vault_parameters = FinalizedAssetAuthVaultParameters {
        vault_asset_id,
        keeper_asset_id,
        supplier_asset_id,
        keeper_min_asset_amount: 1,
        with_keeper_asset_burn,
        with_supplier_asset_burn: false,
        network: *context.get_network(),
    };

    let asset_auth_vault = setup_asset_auth_vault(context, vault_parameters)?;

    let finalized_vault = final_supply(context, &asset_auth_vault, amount_to_supply)?;

    fund_keeper(context, keeper, vault_parameters.keeper_asset_id)?;

    Ok((finalized_vault, vault_parameters))
}

#[simplex::test]
fn withdraw_all_succeeds_with_one_explicit_output_without_keeper_asset_burn(
    context: simplex::TestContext,
) -> anyhow::Result<()> {
    let provider = context.get_default_provider();
    let keeper = context.random_signer();

    let (finalized_vault, vault_parameters) =
        default_vault_withdrawing_all_setup(&context, &keeper, vec![5000], 1000, false)?;

    let finalized_vault_utxo =
        provider.fetch_scripthash_utxos(&finalized_vault.get_script_pubkey())?[0].clone();

    let current_vault_balance = finalized_vault_utxo.explicit_amount();

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

    finalized_vault.attach_withdrawing_all(&mut ft, finalized_vault_utxo, 0, 0);

    ft.add_output(PartialOutput::new(
        keeper.get_address().script_pubkey(),
        current_vault_balance,
        vault_parameters.vault_asset_id,
    ));

    let txid = keeper.broadcast(&ft)?;
    provider.wait(&txid)?;

    Ok(())
}

#[simplex::test]
fn withdraw_all_succeeds_with_one_explicit_output_with_keeper_asset_burn(
    context: simplex::TestContext,
) -> anyhow::Result<()> {
    let provider = context.get_default_provider();
    let keeper = context.random_signer();

    let (finalized_vault, vault_parameters) =
        default_vault_withdrawing_all_setup(&context, &keeper, vec![5000], 1000, true)?;

    let finalized_vault_utxo =
        provider.fetch_scripthash_utxos(&finalized_vault.get_script_pubkey())?[0].clone();

    let current_vault_balance = finalized_vault_utxo.explicit_amount();

    let keeper_auth_utxo = keeper.get_utxos_asset(vault_parameters.keeper_asset_id)?[0].clone();

    let mut ft = FinalTransaction::new();

    ft.add_input(
        PartialInput::new(keeper_auth_utxo.clone()),
        RequiredSignature::NativeEcdsa,
    );
    ft.add_output(PartialOutput::new(
        Script::new_op_return(b"burn"),
        keeper_auth_utxo.explicit_amount(),
        keeper_auth_utxo.explicit_asset(),
    ));

    finalized_vault.attach_withdrawing_all(&mut ft, finalized_vault_utxo, 0, 0);

    ft.add_output(PartialOutput::new(
        keeper.get_address().script_pubkey(),
        current_vault_balance,
        vault_parameters.vault_asset_id,
    ));

    let txid = keeper.broadcast(&ft)?;
    provider.wait(&txid)?;

    Ok(())
}

#[simplex::test]
fn withdraw_all_succeeds_with_one_explicit_output(
    context: simplex::TestContext,
) -> anyhow::Result<()> {
    let provider = context.get_default_provider();
    let keeper = context.random_signer();

    let (finalized_vault, vault_parameters) =
        default_vault_withdrawing_all_setup(&context, &keeper, vec![5000], 1000, false)?;

    let finalized_vault_utxo =
        provider.fetch_scripthash_utxos(&finalized_vault.get_script_pubkey())?[0].clone();

    let current_vault_balance = finalized_vault_utxo.explicit_amount();

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

    finalized_vault.attach_withdrawing_all(&mut ft, finalized_vault_utxo, 0, 0);

    ft.add_output(PartialOutput::new(
        keeper.get_address().script_pubkey(),
        current_vault_balance,
        vault_parameters.vault_asset_id,
    ));

    let txid = keeper.broadcast(&ft)?;
    provider.wait(&txid)?;

    Ok(())
}

#[simplex::test]
fn withdraw_all_succeeds_with_several_explicit_outputs(
    context: simplex::TestContext,
) -> anyhow::Result<()> {
    let provider = context.get_default_provider();
    let keeper = context.random_signer();

    let (finalized_vault, vault_parameters) =
        default_vault_withdrawing_all_setup(&context, &keeper, vec![5000], 1000, false)?;

    let finalized_vault_utxo =
        provider.fetch_scripthash_utxos(&finalized_vault.get_script_pubkey())?[0].clone();

    let current_vault_balance = finalized_vault_utxo.explicit_amount();

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

    finalized_vault.attach_withdrawing_all(&mut ft, finalized_vault_utxo, 0, 0);

    ft.add_output(PartialOutput::new(
        keeper.get_address().script_pubkey(),
        current_vault_balance / 2,
        vault_parameters.vault_asset_id,
    ));
    ft.add_output(PartialOutput::new(
        keeper.get_address().script_pubkey(),
        current_vault_balance / 2,
        vault_parameters.vault_asset_id,
    ));

    let txid = keeper.broadcast(&ft)?;
    provider.wait(&txid)?;

    Ok(())
}

#[simplex::test]
fn withdraw_all_succeeds_with_confidential_output(
    context: simplex::TestContext,
) -> anyhow::Result<()> {
    let provider = context.get_default_provider();
    let keeper = context.random_signer();

    let (finalized_vault, vault_parameters) =
        default_vault_withdrawing_all_setup(&context, &keeper, vec![5000], 1000, false)?;

    let finalized_vault_utxo =
        provider.fetch_scripthash_utxos(&finalized_vault.get_script_pubkey())?[0].clone();

    let current_vault_balance = finalized_vault_utxo.explicit_amount();

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

    finalized_vault.attach_withdrawing_all(&mut ft, finalized_vault_utxo, 0, 0);

    ft.add_output(
        PartialOutput::new(
            keeper.get_confidential_address().script_pubkey(),
            current_vault_balance,
            vault_parameters.vault_asset_id,
        )
        .with_blinding_key(keeper.get_blinding_public_key()),
    );

    let txid = keeper.broadcast(&ft)?;
    provider.wait(&txid)?;

    Ok(())
}
