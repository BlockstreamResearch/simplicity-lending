use simplex::signer::Signer;
use simplicityhl::elements::{AssetId, OutPoint, TxOut};

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
) -> Vec<(OutPoint, TxOut)> {
    let signer_utxos = signer.get_wpkh_utxos().unwrap();

    let filtered_utxos = filter_utxos_by_asset_id(signer_utxos, asset_id);
    filter_utxos_by_amount(filtered_utxos, amount, amount_filter)
}

pub fn filter_signer_utxos_by_asset_id(
    signer: &Signer,
    asset_id: AssetId,
) -> Vec<(OutPoint, TxOut)> {
    let signer_utxos = signer.get_wpkh_utxos().unwrap();

    filter_utxos_by_asset_id(signer_utxos, asset_id)
}

pub fn filter_signer_utxos_by_amount(
    signer: &Signer,
    amount: u64,
    amount_filter: AmountFilter,
) -> Vec<(OutPoint, TxOut)> {
    let signer_utxos = signer.get_wpkh_utxos().unwrap();

    filter_utxos_by_amount(signer_utxos, amount, amount_filter)
}

pub fn filter_utxos_by_amount(
    utxos: Vec<(OutPoint, TxOut)>,
    amount: u64,
    amount_filter: AmountFilter,
) -> Vec<(OutPoint, TxOut)> {
    let filtered_utxos: Vec<(OutPoint, TxOut)> = utxos
        .into_iter()
        .filter(|utxo| match amount_filter {
            AmountFilter::LessThan => utxo.1.value.explicit().unwrap() < amount,
            AmountFilter::GreaterThan => utxo.1.value.explicit().unwrap() > amount,
            AmountFilter::EqualTo => utxo.1.value.explicit().unwrap() == amount,
        })
        .collect();

    filtered_utxos
}

pub fn filter_utxos_by_asset_id(
    utxos: Vec<(OutPoint, TxOut)>,
    asset_id: AssetId,
) -> Vec<(OutPoint, TxOut)> {
    let filtered_utxos: Vec<(OutPoint, TxOut)> = utxos
        .into_iter()
        .filter(|utxo| utxo.1.asset.explicit().unwrap() == asset_id)
        .collect();

    filtered_utxos
}
