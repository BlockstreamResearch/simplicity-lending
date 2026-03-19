use lending_contracts::utils::get_random_seed;

use simplex::simplicityhl::elements::{AssetId, OutPoint, TxOut, Txid};
use simplex::transaction::{
    FinalTransaction, PartialInput, PartialOutput, RequiredSignature, partial_input::IssuanceInput,
};

pub fn issue_asset(
    context: &simplex::TestContext,
    asset_amount: u64,
) -> anyhow::Result<(Txid, AssetId)> {
    let provider = context.get_provider();
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

    let (tx, _) = signer.finalize(&ft, 1).unwrap();

    let txid = provider.broadcast_transaction(&tx).unwrap();

    Ok((txid, asset_id))
}
