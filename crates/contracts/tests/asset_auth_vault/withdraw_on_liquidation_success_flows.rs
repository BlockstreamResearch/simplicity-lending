use lending_contracts::programs::program::SimplexProgram;

use simplex::simplicityhl::elements::Script;
use simplex::transaction::{FinalTransaction, NativeSignature, PartialInput, PartialOutput};

use super::setup::setup_withdrawable_on_liquidation_vault;

#[simplex::test]
fn withdraw_on_liquidation_succeeds_with_keeper_asset_burn(
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

    let current_vault_balance = asset_auth_vault_utxo.explicit_amount();

    let keeper_auth_utxo = keeper.get_utxos_asset(vault_parameters.keeper_asset_id)?[0].clone();

    let mut ft = FinalTransaction::new();

    ft.add_input(
        PartialInput::new(keeper_auth_utxo.clone()),
        Some(NativeSignature::Ecdsa),
    );
    ft.add_output(PartialOutput::new(
        Script::new_op_return(b"burn"),
        keeper_auth_utxo.explicit_amount(),
        keeper_auth_utxo.explicit_asset(),
    ));

    asset_auth_vault.attach_withdrawing_on_liquidation(&mut ft, asset_auth_vault_utxo, 0, 0);

    ft.add_output(PartialOutput::new(
        keeper.get_address().script_pubkey(),
        current_vault_balance,
        vault_parameters.vault_asset_id,
    ));

    keeper.broadcast(&ft)?.wait()?;

    assert!(
        provider
            .fetch_scripthash_utxos(&asset_auth_vault.get_script_pubkey())?
            .is_empty()
    );

    Ok(())
}
