use lending_contracts::programs::fee_collector::FeeCollector;
use lending_contracts::programs::program::SimplexProgram;

use simplex::simplicityhl::elements::AssetId;
use simplex::transaction::{FinalTransaction, UTXO};

use super::common::issuance::issue_asset;
use super::setup::{
    add_deposit_program_input, add_native_input, add_signer_output, assert_finalize_fails,
    find_signer_asset_utxo, get_collector_utxo, setup_fee_collector,
};

fn setup_deposit(
    context: &simplex::TestContext,
    initial_amount: u64,
    remaining_amounts: Vec<u64>,
) -> anyhow::Result<(FeeCollector, AssetId, UTXO)> {
    let (fee_collector, asset_id) =
        setup_fee_collector(context, initial_amount, remaining_amounts)?;
    let collector_utxo = get_collector_utxo(context, &fee_collector)?;

    Ok((fee_collector, asset_id, collector_utxo))
}

#[simplex::test]
fn fails_to_deposit_zero_additional_amount(context: simplex::TestContext) -> anyhow::Result<()> {
    let signer = context.get_default_signer();
    let initial_amount = 3_000;
    let (fee_collector, asset_id, collector_utxo) =
        setup_deposit(&context, initial_amount, vec![])?;

    let mut ft = FinalTransaction::new();
    add_deposit_program_input(&mut ft, &fee_collector, collector_utxo, 0, 0);
    fee_collector.add_program_output(&mut ft, asset_id, initial_amount);

    assert_finalize_fails(signer, &ft);

    Ok(())
}

#[simplex::test]
fn fails_to_deposit_when_continuing_output_script_changes(
    context: simplex::TestContext,
) -> anyhow::Result<()> {
    let signer = context.get_default_signer();
    let initial_amount = 3_000;
    let additional_amount = 5_000;
    let (fee_collector, asset_id, collector_utxo) =
        setup_deposit(&context, initial_amount, vec![additional_amount])?;

    let mut ft = FinalTransaction::new();
    add_native_input(
        &mut ft,
        find_signer_asset_utxo(signer, asset_id, additional_amount)?,
    );
    add_deposit_program_input(
        &mut ft,
        &fee_collector,
        collector_utxo,
        0,
        additional_amount,
    );
    add_signer_output(
        &mut ft,
        signer,
        initial_amount + additional_amount,
        asset_id,
    );

    assert_finalize_fails(signer, &ft);

    Ok(())
}

#[simplex::test]
fn fails_to_deposit_when_output_index_points_to_a_different_output(
    context: simplex::TestContext,
) -> anyhow::Result<()> {
    let signer = context.get_default_signer();
    let initial_amount = 3_000;
    let extra_utxo_amount = 8_000;
    let additional_amount = 5_000;
    let (fee_collector, asset_id, collector_utxo) =
        setup_deposit(&context, initial_amount, vec![extra_utxo_amount])?;

    let mut ft = FinalTransaction::new();
    add_native_input(
        &mut ft,
        find_signer_asset_utxo(signer, asset_id, extra_utxo_amount)?,
    );
    add_deposit_program_input(
        &mut ft,
        &fee_collector,
        collector_utxo,
        1,
        additional_amount,
    );
    fee_collector.add_program_output(&mut ft, asset_id, initial_amount + additional_amount);
    add_signer_output(
        &mut ft,
        signer,
        extra_utxo_amount - additional_amount,
        asset_id,
    );

    assert_finalize_fails(signer, &ft);

    Ok(())
}

#[simplex::test]
fn fails_to_deposit_when_continuing_output_increases_by_less_than_claimed(
    context: simplex::TestContext,
) -> anyhow::Result<()> {
    let signer = context.get_default_signer();
    let initial_amount = 3_000;
    let additional_amount = 5_000;
    let actual_increase = 1_000;
    let (fee_collector, asset_id, collector_utxo) =
        setup_deposit(&context, initial_amount, vec![additional_amount])?;

    let mut ft = FinalTransaction::new();
    add_native_input(
        &mut ft,
        find_signer_asset_utxo(signer, asset_id, additional_amount)?,
    );
    add_deposit_program_input(
        &mut ft,
        &fee_collector,
        collector_utxo,
        0,
        additional_amount,
    );
    fee_collector.add_program_output(&mut ft, asset_id, initial_amount + actual_increase);
    add_signer_output(
        &mut ft,
        signer,
        additional_amount - actual_increase,
        asset_id,
    );

    assert_finalize_fails(signer, &ft);

    Ok(())
}

#[simplex::test]
fn fails_to_deposit_when_continuing_output_increases_by_more_than_claimed(
    context: simplex::TestContext,
) -> anyhow::Result<()> {
    let signer = context.get_default_signer();
    let initial_amount = 3_000;
    let extra_utxo_amount = 5_000;
    let claimed_additional_amount = 1_000;
    let (fee_collector, asset_id, collector_utxo) =
        setup_deposit(&context, initial_amount, vec![extra_utxo_amount])?;

    let mut ft = FinalTransaction::new();
    add_native_input(
        &mut ft,
        find_signer_asset_utxo(signer, asset_id, extra_utxo_amount)?,
    );
    add_deposit_program_input(
        &mut ft,
        &fee_collector,
        collector_utxo,
        0,
        claimed_additional_amount,
    );
    fee_collector.add_program_output(&mut ft, asset_id, initial_amount + extra_utxo_amount);

    assert_finalize_fails(signer, &ft);

    Ok(())
}

#[simplex::test]
fn fails_to_deposit_when_continuing_output_asset_changes(
    context: simplex::TestContext,
) -> anyhow::Result<()> {
    let signer = context.get_default_signer();
    let initial_amount = 3_000;
    let additional_amount = 5_000;
    let expected_continuing_amount = initial_amount + additional_amount;
    let (fee_collector, asset_id, collector_utxo) =
        setup_deposit(&context, initial_amount, vec![additional_amount])?;
    let other_asset_id = issue_asset(&context, expected_continuing_amount)?;

    let mut ft = FinalTransaction::new();
    add_native_input(
        &mut ft,
        find_signer_asset_utxo(signer, asset_id, additional_amount)?,
    );
    add_native_input(
        &mut ft,
        find_signer_asset_utxo(signer, other_asset_id, expected_continuing_amount)?,
    );
    add_deposit_program_input(
        &mut ft,
        &fee_collector,
        collector_utxo,
        0,
        additional_amount,
    );
    fee_collector.add_program_output(&mut ft, other_asset_id, expected_continuing_amount);
    add_signer_output(&mut ft, signer, expected_continuing_amount, asset_id);

    assert_finalize_fails(signer, &ft);

    Ok(())
}
