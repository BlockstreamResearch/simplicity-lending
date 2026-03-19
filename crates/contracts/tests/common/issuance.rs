#![allow(dead_code)]
use lending_contracts::transactions::utility::{
    UTILITY_NFTS_COUNT, issue_preparation_utxos, issue_utility_nfts,
};
use lending_contracts::utils::{LendingParameters, get_random_seed};

use simplex::simplicityhl::elements::{AssetId, OutPoint, TxOut, Txid};
use simplex::transaction::{
    FinalTransaction, PartialInput, PartialOutput, RequiredSignature, partial_input::IssuanceInput,
};

use super::{
    tx_steps::{finalize_and_broadcast, finalize_strict_and_broadcast},
    wallet::{
        AmountFilter, filter_signer_utxos_by_asset_and_amount, filter_signer_utxos_by_asset_id,
    },
};

pub fn issue_asset(
    context: &simplex::TestContext,
    asset_amount: u64,
) -> anyhow::Result<(Txid, AssetId)> {
    let signer = context.get_signer();

    let mut ft = FinalTransaction::new(*context.get_network());

    let signer_utxos = signer.get_wpkh_utxos().unwrap();
    let policy_utxos: Vec<(OutPoint, TxOut)> = signer_utxos
        .into_iter()
        .filter(|utxo| utxo.1.asset.explicit().unwrap() == context.get_network().policy_asset())
        .collect();
    let first_utxo = policy_utxos.first().unwrap();

    let asset_entropy = get_random_seed();

    let asset_id = ft.add_issuance_input(
        PartialInput::new(first_utxo.0, first_utxo.1.clone()),
        IssuanceInput::new(asset_amount, asset_entropy),
        RequiredSignature::NativeEcdsa,
    )?;

    let signer_script_pubkey = signer.get_wpkh_address().unwrap().script_pubkey();

    ft.add_output(PartialOutput::new(
        signer_script_pubkey.clone(),
        asset_amount,
        asset_id,
    ));

    ft.add_output(PartialOutput::new(
        signer_script_pubkey,
        first_utxo.1.value.explicit().unwrap(),
        first_utxo.1.asset.explicit().unwrap(),
    ));

    let txid = finalize_and_broadcast(context, &ft)?;

    Ok((txid, asset_id))
}

pub fn issue_preparation_utxos_tx(
    context: &simplex::TestContext,
) -> anyhow::Result<(Txid, AssetId)> {
    let signer = context.get_signer();

    let signer_script_pubkey = signer.get_wpkh_address().unwrap().script_pubkey();

    let signer_utxos = signer.get_wpkh_utxos().unwrap();
    let first_utxo = signer_utxos.first().unwrap();

    let (ft, asset_id) = issue_preparation_utxos(
        (
            PartialInput::new(first_utxo.0, first_utxo.1.clone()),
            RequiredSignature::NativeEcdsa,
        ),
        signer_script_pubkey,
        *context.get_network(),
    )?;

    let txid = finalize_and_broadcast(context, &ft)?;

    Ok((txid, asset_id))
}

pub fn issue_utility_nfts_tx(
    context: &simplex::TestContext,
    offer_params: &LendingParameters,
    preparation_asset_id: AssetId,
) -> anyhow::Result<Txid> {
    let signer = context.get_signer();

    let signer_script_pubkey = signer.get_wpkh_address().unwrap().script_pubkey();
    let issuance_utxos = filter_signer_utxos_by_asset_id(signer, preparation_asset_id);

    assert_eq!(issuance_utxos.len(), UTILITY_NFTS_COUNT);

    let issuance_inputs = issuance_utxos
        .iter()
        .map(|utxo| {
            (
                PartialInput::new(utxo.0, utxo.1.clone()),
                RequiredSignature::NativeEcdsa,
            )
        })
        .collect();

    let issuance_asset_entropy = get_random_seed();
    let mut ft = issue_utility_nfts(
        issuance_inputs,
        signer_script_pubkey,
        offer_params,
        1,
        issuance_asset_entropy,
        *context.get_network(),
    )?;

    let signer_policy_utxos = filter_signer_utxos_by_asset_and_amount(
        signer,
        context.get_network().policy_asset(),
        100_000,
        AmountFilter::LessThan,
    );
    let fee_utxo = signer_policy_utxos.first().unwrap();

    ft.add_input(
        PartialInput::new(fee_utxo.0, fee_utxo.1.clone()),
        RequiredSignature::NativeEcdsa,
    )?;

    let txid = finalize_strict_and_broadcast(context, &ft)?;

    Ok(txid)
}
