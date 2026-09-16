use lending_contracts::programs::fee_collector::{
    FeeCollector, FeeCollectorParameters, FeeCollectorWitnessBranch,
};
use lending_contracts::programs::program::SimplexProgram;

use simplex::signer::Signer;
use simplex::simplicityhl::elements::AssetId;
use simplex::simplicityhl::elements::secp256k1_zkp::XOnlyPublicKey;
use simplex::transaction::{
    FinalTransaction, PartialInput, PartialOutput, RequiredSignature, UTXO,
};

use super::common::issuance::issue_asset;
use super::common::wallet::{get_split_utxo_ft, split_first_signer_utxo};

pub(super) fn setup_fee_collector(
    context: &simplex::TestContext,
    initial_amount: u64,
    remaining_amounts: Vec<u64>,
) -> anyhow::Result<(FeeCollector, AssetId)> {
    setup_fee_collector_with_withdrawal_pubkey(
        context,
        initial_amount,
        remaining_amounts,
        context.get_default_signer().get_schnorr_public_key(),
    )
}

pub(super) fn setup_fee_collector_with_withdrawal_pubkey(
    context: &simplex::TestContext,
    initial_amount: u64,
    remaining_amounts: Vec<u64>,
    withdrawal_pubkey: XOnlyPublicKey,
) -> anyhow::Result<(FeeCollector, AssetId)> {
    let signer = context.get_default_signer();

    split_first_signer_utxo(context, vec![1000, 5000, 10000]);

    let mut split_amounts = vec![initial_amount];
    split_amounts.extend(remaining_amounts);
    assert_eq!(
        split_amounts
            .iter()
            .filter(|&&amount| amount == initial_amount)
            .count(),
        1,
        "initial_amount must uniquely identify the funding utxo"
    );

    let asset_id = issue_asset(context, split_amounts.iter().sum())?;
    let asset_utxo = signer.get_utxos_asset(asset_id)?[0].clone();
    signer
        .broadcast(&get_split_utxo_ft(
            asset_utxo,
            split_amounts,
            signer,
            *context.get_network(),
        ))?
        .wait()?;

    let fee_collector = FeeCollector::new(FeeCollectorParameters {
        withdrawal_pubkey,
        network: *context.get_network(),
    });

    let mut ft = FinalTransaction::new();
    add_native_input(
        &mut ft,
        find_signer_asset_utxo(signer, asset_id, initial_amount)?,
    );
    fee_collector.attach_creation(&mut ft, asset_id, initial_amount);
    signer.broadcast(&ft)?.wait()?;

    check_collector_amount(context, &fee_collector, initial_amount)?;

    Ok((fee_collector, asset_id))
}

pub(super) fn get_collector_utxos(
    context: &simplex::TestContext,
    fee_collector: &FeeCollector,
) -> anyhow::Result<Vec<UTXO>> {
    Ok(context
        .get_default_provider()
        .fetch_scripthash_utxos(&fee_collector.get_script_pubkey())?)
}

pub(super) fn get_collector_utxo(
    context: &simplex::TestContext,
    fee_collector: &FeeCollector,
) -> anyhow::Result<UTXO> {
    let collector_utxos = get_collector_utxos(context, fee_collector)?;
    assert_eq!(collector_utxos.len(), 1);

    Ok(collector_utxos.into_iter().next().unwrap())
}

pub(super) fn check_collector_amount(
    context: &simplex::TestContext,
    fee_collector: &FeeCollector,
    expected_amount: u64,
) -> anyhow::Result<()> {
    assert_eq!(
        get_collector_utxo(context, fee_collector)?.explicit_amount(),
        expected_amount
    );

    Ok(())
}

pub(super) fn check_collector_empty(
    context: &simplex::TestContext,
    fee_collector: &FeeCollector,
) -> anyhow::Result<()> {
    assert!(get_collector_utxos(context, fee_collector)?.is_empty());

    Ok(())
}

pub(super) fn find_utxo_with_amount(utxos: &[UTXO], amount: u64) -> UTXO {
    let matching: Vec<_> = utxos
        .iter()
        .filter(|utxo| utxo.explicit_amount() == amount)
        .cloned()
        .collect();
    assert_eq!(
        matching.len(),
        1,
        "expected exactly one utxo of the requested amount"
    );

    matching.into_iter().next().unwrap()
}

pub(super) fn find_signer_asset_utxo(
    signer: &Signer,
    asset_id: AssetId,
    amount: u64,
) -> anyhow::Result<UTXO> {
    Ok(find_utxo_with_amount(
        &signer.get_utxos_asset(asset_id)?,
        amount,
    ))
}

pub(super) fn add_native_input(ft: &mut FinalTransaction, utxo: UTXO) {
    ft.add_input(PartialInput::new(utxo), RequiredSignature::NativeEcdsa);
}

pub(super) fn add_signer_output(
    ft: &mut FinalTransaction,
    signer: &Signer,
    amount: u64,
    asset_id: AssetId,
) {
    ft.add_output(PartialOutput::new(
        signer.get_address().script_pubkey(),
        amount,
        asset_id,
    ));
}

pub(super) fn add_deposit_program_input(
    ft: &mut FinalTransaction,
    fee_collector: &FeeCollector,
    collector_utxo: UTXO,
    output_index: u32,
    additional_amount: u64,
) {
    fee_collector.add_program_input(
        ft,
        collector_utxo,
        FeeCollectorWitnessBranch::Deposit {
            output_index,
            additional_amount,
        }
        .build_witness(),
    );
}

pub(super) fn deposit_amount(
    context: &simplex::TestContext,
    fee_collector: &FeeCollector,
    asset_id: AssetId,
    additional_amount: u64,
) -> anyhow::Result<()> {
    let signer = context.get_default_signer();

    let mut ft = FinalTransaction::new();
    add_native_input(
        &mut ft,
        find_signer_asset_utxo(signer, asset_id, additional_amount)?,
    );
    fee_collector.attach_deposit(
        &mut ft,
        get_collector_utxo(context, fee_collector)?,
        additional_amount,
    );
    signer.broadcast(&ft)?.wait()?;

    Ok(())
}

pub(super) fn assert_finalize_fails(signer: &Signer, ft: &FinalTransaction) {
    assert!(
        signer.finalize(ft).is_err(),
        "expected finalize to fail, but it succeeded"
    );
}
