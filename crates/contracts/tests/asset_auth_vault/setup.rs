use lending_contracts::programs::asset_auth_vault::{AssetAuthVault, AssetAuthVaultParameters};

use lending_contracts::programs::program::SimplexProgram;
use lending_contracts::utils::get_random_seed;
use simplex::simplicityhl::elements::AssetId;
use simplex::transaction::partial_input::IssuanceInput;
use simplex::transaction::{
    FinalTransaction, PartialInput, PartialOutput, RequiredSignature, UTXO,
};

use super::common::issuance::issue_asset;
use super::common::tx_steps::finalize_and_broadcast;
use super::common::wallet::{get_split_utxo_ft, split_first_signer_utxo};

pub(super) fn issue_auth_assets(
    context: &simplex::TestContext,
    supplier_auth_asset_amount: u64,
    keeper_auth_asset_amount: u64,
) -> anyhow::Result<(AssetId, AssetId)> {
    let provider = context.get_default_provider();
    let signer = context.get_default_signer();

    let txid = split_first_signer_utxo(context, vec![1000, 5000, 10000]);
    provider.wait(&txid)?;

    let policy_utxos = signer.get_utxos_asset(context.get_network().policy_asset())?;

    let first_utxo = policy_utxos[0].clone();
    let second_utxo = policy_utxos[1].clone();

    let issuance_entropy = get_random_seed();

    let mut ft = FinalTransaction::new();

    let supplier_auth_issuance_details = ft.add_issuance_input(
        PartialInput::new(first_utxo),
        IssuanceInput::new_issuance(supplier_auth_asset_amount, 0, issuance_entropy),
        RequiredSignature::NativeEcdsa,
    );
    let keeper_auth_issuance_details = ft.add_issuance_input(
        PartialInput::new(second_utxo),
        IssuanceInput::new_issuance(keeper_auth_asset_amount, 0, issuance_entropy),
        RequiredSignature::NativeEcdsa,
    );

    ft.add_output(PartialOutput::new(
        signer.get_address().script_pubkey(),
        supplier_auth_asset_amount,
        supplier_auth_issuance_details.asset_id,
    ));
    ft.add_output(PartialOutput::new(
        signer.get_address().script_pubkey(),
        keeper_auth_asset_amount,
        keeper_auth_issuance_details.asset_id,
    ));

    let txid = finalize_and_broadcast(context, &ft)?;
    provider.wait(&txid)?;

    Ok((
        supplier_auth_issuance_details.asset_id,
        keeper_auth_issuance_details.asset_id,
    ))
}

pub(super) fn prepare_vault_asset(
    context: &simplex::TestContext,
    total_vault_asset_amount: u64,
    split_amounts: Vec<u64>,
) -> anyhow::Result<AssetId> {
    let provider = context.get_default_provider();
    let signer = context.get_default_signer();

    let (txid, vault_asset_id) = issue_asset(context, total_vault_asset_amount)?;
    provider.wait(&txid)?;

    let vault_asset_utxo = signer.get_utxos_asset(vault_asset_id)?[0].clone();

    let ft = get_split_utxo_ft(
        vault_asset_utxo,
        split_amounts,
        signer,
        *context.get_network(),
    );

    let txid = finalize_and_broadcast(context, &ft)?;
    provider.wait(&txid)?;

    Ok(vault_asset_id)
}

pub(super) fn make_confidential(
    context: &simplex::TestContext,
    asset_utxo: UTXO,
) -> anyhow::Result<()> {
    let provider = context.get_default_provider();
    let signer = context.get_default_signer();

    let mut ft = FinalTransaction::new();

    ft.add_output(
        PartialOutput::new(
            signer.get_confidential_address().script_pubkey(),
            asset_utxo.explicit_amount(),
            asset_utxo.explicit_asset(),
        )
        .with_blinding_key(signer.get_blinding_public_key()),
    );
    ft.add_input(
        PartialInput::new(asset_utxo),
        RequiredSignature::NativeEcdsa,
    );

    let txid = finalize_and_broadcast(context, &ft)?;
    provider.wait(&txid)?;

    Ok(())
}

pub(super) fn setup_asset_auth_vault(
    context: &simplex::TestContext,
    vault_parameters: AssetAuthVaultParameters,
) -> anyhow::Result<AssetAuthVault> {
    let provider = context.get_default_provider();
    let signer = context.get_default_signer();

    let vault_asset_utxo = signer.get_utxos_asset(vault_parameters.vault_asset_id)?[0].clone();
    let vault_asset_amount = vault_asset_utxo.explicit_amount();

    let mut ft = FinalTransaction::new();

    ft.add_input(
        PartialInput::new(vault_asset_utxo),
        RequiredSignature::NativeEcdsa,
    );

    let asset_auth_vault = AssetAuthVault::new_active(vault_parameters);

    asset_auth_vault.attach_creation(&mut ft, vault_asset_amount);

    let txid = finalize_and_broadcast(context, &ft)?;
    provider.wait(&txid)?;

    let asset_auth_vault_utxo =
        provider.fetch_scripthash_utxos(&asset_auth_vault.get_script_pubkey())?[0].clone();

    assert_eq!(asset_auth_vault_utxo.explicit_amount(), vault_asset_amount);

    Ok(asset_auth_vault)
}

pub(super) fn final_supply(
    context: &simplex::TestContext,
    asset_auth_vault: &AssetAuthVault,
    amount_to_supply: u64,
) -> anyhow::Result<AssetAuthVault> {
    let provider = context.get_default_provider();
    let signer = context.get_default_signer();

    let vault_parameters = *asset_auth_vault.get_parameters();

    let asset_auth_vault_utxo =
        provider.fetch_scripthash_utxos(&asset_auth_vault.get_script_pubkey())?[0].clone();

    let utxo_to_supply = signer.get_utxos_asset(vault_parameters.vault_asset_id)?[0].clone();
    let vault_asset_utxo_amount = utxo_to_supply.explicit_amount();

    assert!(vault_asset_utxo_amount >= amount_to_supply);

    let supplier_auth_utxo = signer.get_utxos_asset(vault_parameters.supplier_asset_id)?[0].clone();

    let mut ft = FinalTransaction::new();

    ft.add_input(
        PartialInput::new(supplier_auth_utxo.clone()),
        RequiredSignature::NativeEcdsa,
    );
    ft.add_input(
        PartialInput::new(utxo_to_supply),
        RequiredSignature::NativeEcdsa,
    );

    let finalized_vault = asset_auth_vault.attach_final_supplying(
        &mut ft,
        asset_auth_vault_utxo,
        0,
        1,
        amount_to_supply,
    );

    ft.add_output(PartialOutput::new(
        signer.get_address().script_pubkey(),
        supplier_auth_utxo.explicit_amount(),
        supplier_auth_utxo.explicit_asset(),
    ));

    if vault_asset_utxo_amount > amount_to_supply {
        ft.add_output(PartialOutput::new(
            signer.get_address().script_pubkey(),
            vault_asset_utxo_amount - amount_to_supply,
            vault_parameters.vault_asset_id,
        ));
    }

    let txid = finalize_and_broadcast(context, &ft)?;
    provider.wait(&txid)?;

    Ok(finalized_vault)
}

pub(super) fn check_vault_amount(
    context: &simplex::TestContext,
    vault: &AssetAuthVault,
    expected_amount: u64,
) -> anyhow::Result<()> {
    let provider = context.get_default_provider();

    let asset_auth_vault_utxo =
        provider.fetch_scripthash_utxos(&vault.get_script_pubkey())?[0].clone();

    assert_eq!(asset_auth_vault_utxo.explicit_amount(), expected_amount);

    Ok(())
}
