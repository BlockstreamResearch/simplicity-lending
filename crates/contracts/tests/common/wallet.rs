#![allow(dead_code)]
use super::tx_steps::finalize_and_broadcast;
use simplex::provider::SimplicityNetwork;
use simplex::signer::Signer;
use simplex::simplicityhl::elements::{AssetId, Txid};
use simplex::transaction::{
    FinalTransaction, PartialInput, PartialOutput, RequiredSignature, UTXO,
};

pub enum AmountFilter {
    LessThan,
    GreaterThan,
    EqualTo,
}

pub fn filter_signer_utxos_by_asset_and_amount(
    signer: &Signer,
    asset_id: AssetId,
    amount: u64,
    amount_filter: AmountFilter,
) -> Vec<UTXO> {
    let signer_utxos = signer.get_utxos().unwrap();

    let filtered_utxos = filter_utxos_by_asset_id(signer_utxos, asset_id);
    filter_utxos_by_amount(filtered_utxos, amount, amount_filter)
}

pub fn filter_signer_utxos_by_asset_id(signer: &Signer, asset_id: AssetId) -> Vec<UTXO> {
    let signer_utxos = signer.get_utxos().unwrap();

    filter_utxos_by_asset_id(signer_utxos, asset_id)
}

pub fn filter_signer_utxos_by_amount(
    signer: &Signer,
    amount: u64,
    amount_filter: AmountFilter,
) -> Vec<UTXO> {
    let signer_utxos = signer.get_utxos().unwrap();

    filter_utxos_by_amount(signer_utxos, amount, amount_filter)
}

pub fn filter_utxos_by_amount(
    utxos: Vec<UTXO>,
    amount: u64,
    amount_filter: AmountFilter,
) -> Vec<UTXO> {
    let filtered_utxos: Vec<UTXO> = utxos
        .into_iter()
        .filter(|utxo| match amount_filter {
            AmountFilter::LessThan => utxo.explicit_amount() < amount,
            AmountFilter::GreaterThan => utxo.explicit_amount() > amount,
            AmountFilter::EqualTo => utxo.explicit_amount() == amount,
        })
        .collect();

    filtered_utxos
}

pub fn filter_utxos_by_asset_id(utxos: Vec<UTXO>, asset_id: AssetId) -> Vec<UTXO> {
    let filtered_utxos: Vec<UTXO> = utxos
        .into_iter()
        .filter(|utxo| utxo.explicit_asset() == asset_id)
        .collect();

    filtered_utxos
}

pub fn get_split_utxo_ft(
    utxo: UTXO,
    amounts: Vec<u64>,
    signer: &Signer,
    network: SimplicityNetwork,
) -> FinalTransaction {
    let utxo_asset_id = utxo.explicit_asset();
    let utxo_amount = utxo.explicit_amount();

    let mut ft = FinalTransaction::new();

    ft.add_input(PartialInput::new(utxo), RequiredSignature::NativeEcdsa);

    let signer_script_pubkey = signer.get_address().script_pubkey();
    let mut total_amount = 0;

    for amount in amounts {
        ft.add_output(PartialOutput::new(
            signer_script_pubkey.clone(),
            amount,
            utxo_asset_id,
        ));
        total_amount += amount;
    }

    assert!(
        total_amount <= utxo_amount,
        "Total amounts after split must be less than the utxo amount"
    );

    if utxo_asset_id != network.policy_asset() && total_amount < utxo_amount {
        ft.add_output(PartialOutput::new(
            signer_script_pubkey.clone(),
            utxo_amount - total_amount,
            utxo_asset_id,
        ));
    }

    ft
}

pub fn split_first_signer_utxo(context: &simplex::TestContext, amounts: Vec<u64>) -> Txid {
    let signer = context.get_default_signer();

    let signer_utxos = signer.get_utxos().unwrap();
    let signer_utxo = signer_utxos
        .first()
        .expect("Signer does not have any utxos");

    let ft = get_split_utxo_ft(signer_utxo.clone(), amounts, signer, *context.get_network());
    finalize_and_broadcast(context, &ft).unwrap()
}
