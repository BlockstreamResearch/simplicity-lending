#![allow(dead_code)]
use lending_contracts::utils::get_random_seed;

use simplex::simplicityhl::elements::{AssetId, Txid};
use simplex::transaction::{
    FinalTransaction, PartialInput, PartialOutput, RequiredSignature, partial_input::IssuanceInput,
};

use super::tx_steps::finalize_and_broadcast;

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
