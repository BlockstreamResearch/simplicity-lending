#![allow(dead_code)]
use lending_contracts::programs::pre_lock::UTILITY_NFTS_COUNT;
use lending_contracts::utils::{LendingOfferParameters, get_random_seed};

use simplex::simplicityhl::elements::{AssetId, Txid};
use simplex::transaction::{
    FinalTransaction, PartialInput, PartialOutput, RequiredSignature, partial_input::IssuanceInput,
};

use super::tx_steps::{finalize_and_broadcast, finalize_strict_and_broadcast};

pub const PREPARATION_UTXO_ASSET_AMOUNT: u64 = 10;

pub fn issue_asset(
    context: &simplex::TestContext,
    asset_amount: u64,
) -> anyhow::Result<(Txid, AssetId)> {
    let signer = context.get_default_signer();

    let mut ft = FinalTransaction::new();

    let first_utxo = signer.get_utxos_asset(context.get_network().policy_asset())?[0].clone();

    let asset_entropy = get_random_seed();

    let issuance_details = ft.add_issuance_input(
        PartialInput::new(first_utxo.clone()),
        IssuanceInput::new_issuance(asset_amount, 0, asset_entropy),
        RequiredSignature::NativeEcdsa,
    );

    let signer_script_pubkey = signer.get_address().script_pubkey();

    ft.add_output(PartialOutput::new(
        signer_script_pubkey.clone(),
        asset_amount,
        issuance_details.asset_id,
    ));

    ft.add_output(PartialOutput::new(
        signer_script_pubkey,
        first_utxo.explicit_amount(),
        first_utxo.explicit_asset(),
    ));

    let txid = finalize_and_broadcast(context, &ft)?;

    Ok((txid, issuance_details.asset_id))
}

pub fn issue_preparation_utxos_tx(
    context: &simplex::TestContext,
) -> anyhow::Result<(Txid, AssetId)> {
    let signer = context.get_default_signer();

    let first_utxo = signer.get_utxos()?[0].clone();

    let mut ft = FinalTransaction::new();

    let total_asset_amount = PREPARATION_UTXO_ASSET_AMOUNT * UTILITY_NFTS_COUNT as u64;
    let asset_entropy = get_random_seed();

    let issuance_details = ft.add_issuance_input(
        PartialInput::new(first_utxo.clone()),
        IssuanceInput::new_issuance(total_asset_amount, 0, asset_entropy),
        RequiredSignature::NativeEcdsa,
    );

    for _ in 0..UTILITY_NFTS_COUNT {
        ft.add_output(PartialOutput::new(
            signer.get_address().script_pubkey(),
            PREPARATION_UTXO_ASSET_AMOUNT,
            issuance_details.asset_id,
        ));
    }

    if first_utxo.explicit_asset() != context.get_network().policy_asset() {
        ft.add_output(PartialOutput::new(
            signer.get_address().script_pubkey(),
            first_utxo.explicit_amount(),
            first_utxo.explicit_asset(),
        ));
    }

    let txid = finalize_and_broadcast(context, &ft)?;

    Ok((txid, issuance_details.asset_id))
}

pub fn issue_utility_nfts_tx(
    context: &simplex::TestContext,
    offer_params: &LendingOfferParameters,
    preparation_asset_id: AssetId,
) -> anyhow::Result<Txid> {
    let signer = context.get_default_signer();

    let signer_script_pubkey = signer.get_address().script_pubkey();
    let issuance_utxos = signer.get_utxos_asset(preparation_asset_id)?;

    assert_eq!(issuance_utxos.len(), UTILITY_NFTS_COUNT);

    let mut ft = FinalTransaction::new();

    let (first_parameters_nft_amount, second_parameters_nft_amount) =
        offer_params.encode_parameters_nft_amounts(1)?;

    let utility_nfts_amounts = [
        first_parameters_nft_amount,
        second_parameters_nft_amount,
        1,
        1,
    ];
    let mut asset_ids: Vec<AssetId> = Vec::with_capacity(UTILITY_NFTS_COUNT);

    let issuance_asset_entropy = get_random_seed();

    for (index, utxo) in issuance_utxos.iter().enumerate() {
        let issuance_details = ft.add_issuance_input(
            PartialInput::new(utxo.clone()),
            IssuanceInput::new_issuance(utility_nfts_amounts[index], 0, issuance_asset_entropy),
            RequiredSignature::NativeEcdsa,
        );
        asset_ids.push(issuance_details.asset_id);
    }

    for (index, asset_id) in asset_ids.into_iter().enumerate() {
        ft.add_output(PartialOutput::new(
            signer_script_pubkey.clone(),
            utility_nfts_amounts[index],
            asset_id,
        ));
    }

    for utxo in issuance_utxos {
        ft.add_output(PartialOutput::new(
            signer_script_pubkey.clone(),
            utxo.explicit_amount(),
            utxo.explicit_asset(),
        ));
    }

    let signer_policy_utxos = signer.get_utxos_filter(
        &|utxo| {
            utxo.explicit_asset() == context.get_network().policy_asset()
                && utxo.explicit_amount() <= 100_000
        },
        &|_| true,
    )?;

    let fee_utxo = signer_policy_utxos.first().unwrap();

    ft.add_input(
        PartialInput::new(fee_utxo.clone()),
        RequiredSignature::NativeEcdsa,
    );

    let txid = finalize_strict_and_broadcast(context, &ft)?;

    Ok(txid)
}
