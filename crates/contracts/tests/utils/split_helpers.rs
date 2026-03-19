use simplex::provider::SimplicityNetwork;
use simplex::signer::Signer;
use simplex::simplicityhl::elements::{OutPoint, TxOut, Txid};
use simplex::transaction::{FinalTransaction, PartialInput, PartialOutput, RequiredSignature};

pub fn get_split_utxo_ft(
    utxo: (OutPoint, TxOut),
    amounts: Vec<u64>,
    signer: &Signer,
    network: SimplicityNetwork,
) -> FinalTransaction {
    let utxo_asset_id = utxo.1.asset.explicit().unwrap();
    let utxo_amount = utxo.1.value.explicit().unwrap();

    let mut ft = FinalTransaction::new(network);

    ft.add_input(
        PartialInput::new(utxo.0, utxo.1),
        RequiredSignature::NativeEcdsa,
    )
    .expect("Failed to add input utxo");

    let signer_script_pubkey = signer.get_wpkh_address().unwrap().script_pubkey();
    let mut total_amount = 0;

    for amount in amounts {
        ft.add_output(PartialOutput::new(
            signer_script_pubkey.clone(),
            amount,
            utxo_asset_id.clone(),
        ));
        total_amount += amount;
    }

    if total_amount > utxo_amount {
        panic!("Total amounts after split must be less than the utxo amount");
    }

    if utxo_asset_id != network.policy_asset() && total_amount < utxo_amount {
        ft.add_output(PartialOutput::new(
            signer_script_pubkey.clone(),
            utxo_amount - total_amount,
            utxo_asset_id.clone(),
        ));
    }

    ft
}

pub fn split_first_signer_utxo(context: &simplex::TestContext, amounts: Vec<u64>) -> Txid {
    let provider = context.get_provider();
    let signer = context.get_signer();

    let signer_utxos = signer.get_wpkh_utxos().unwrap();
    let signer_utxo = signer_utxos
        .first()
        .expect("Signer does not have any utxos");

    let ft = get_split_utxo_ft(signer_utxo.clone(), amounts, signer, *context.get_network());

    let (tx, _) = signer.finalize(&ft, 1).unwrap();

    let txid = provider.broadcast_transaction(&tx).unwrap();

    txid
}
