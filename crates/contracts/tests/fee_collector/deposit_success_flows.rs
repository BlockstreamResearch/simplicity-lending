use lending_contracts::programs::program::SimplexProgram;

use simplex::transaction::FinalTransaction;

use super::setup::{
    add_deposit_program_input, add_native_input, add_signer_output, check_collector_amount,
    check_collector_empty, deposit_amount, find_signer_asset_utxo, find_utxo_with_amount,
    get_collector_utxo, get_collector_utxos, setup_fee_collector,
};

#[simplex::test]
fn deposits_additional_funds_into_a_single_utxo(
    context: simplex::TestContext,
) -> anyhow::Result<()> {
    let initial_amount = 3_000;
    let additional_amount = 5_000;
    let (fee_collector, asset_id) =
        setup_fee_collector(&context, initial_amount, vec![additional_amount])?;

    deposit_amount(&context, &fee_collector, asset_id, additional_amount)?;
    check_collector_amount(&context, &fee_collector, initial_amount + additional_amount)?;

    Ok(())
}

#[simplex::test]
fn deposits_twice_and_keeps_a_single_utxo(context: simplex::TestContext) -> anyhow::Result<()> {
    let initial_amount = 2_000;
    let first_deposit = 3_000;
    let second_deposit = 4_000;
    let (fee_collector, asset_id) = setup_fee_collector(
        &context,
        initial_amount,
        vec![first_deposit, second_deposit],
    )?;

    deposit_amount(&context, &fee_collector, asset_id, first_deposit)?;
    check_collector_amount(&context, &fee_collector, initial_amount + first_deposit)?;

    deposit_amount(&context, &fee_collector, asset_id, second_deposit)?;
    check_collector_amount(
        &context,
        &fee_collector,
        initial_amount + first_deposit + second_deposit,
    )?;

    Ok(())
}

#[simplex::test]
fn deposits_with_change_from_a_larger_input(context: simplex::TestContext) -> anyhow::Result<()> {
    let signer = context.get_default_signer();
    let initial_amount = 3_000;
    let extra_utxo_amount = 8_000;
    let additional_amount = 5_000;
    let (fee_collector, asset_id) =
        setup_fee_collector(&context, initial_amount, vec![extra_utxo_amount])?;

    let mut ft = FinalTransaction::new();
    add_native_input(
        &mut ft,
        find_signer_asset_utxo(signer, asset_id, extra_utxo_amount)?,
    );
    fee_collector.attach_deposit(
        &mut ft,
        get_collector_utxo(&context, &fee_collector)?,
        additional_amount,
    );
    add_signer_output(
        &mut ft,
        signer,
        extra_utxo_amount - additional_amount,
        asset_id,
    );
    signer.broadcast(&ft)?.wait()?;

    check_collector_amount(&context, &fee_collector, initial_amount + additional_amount)?;

    Ok(())
}

#[simplex::test]
fn deposits_when_continuing_output_is_not_the_first_output(
    context: simplex::TestContext,
) -> anyhow::Result<()> {
    let signer = context.get_default_signer();
    let initial_amount = 3_000;
    let extra_utxo_amount = 8_000;
    let additional_amount = 5_000;
    let (fee_collector, asset_id) =
        setup_fee_collector(&context, initial_amount, vec![extra_utxo_amount])?;

    let mut ft = FinalTransaction::new();
    add_native_input(
        &mut ft,
        find_signer_asset_utxo(signer, asset_id, extra_utxo_amount)?,
    );
    add_signer_output(
        &mut ft,
        signer,
        extra_utxo_amount - additional_amount,
        asset_id,
    );
    fee_collector.attach_deposit(
        &mut ft,
        get_collector_utxo(&context, &fee_collector)?,
        additional_amount,
    );
    signer.broadcast(&ft)?.wait()?;

    check_collector_amount(&context, &fee_collector, initial_amount + additional_amount)?;

    Ok(())
}

#[simplex::test]
fn deposits_multiple_small_utxos_in_one_transaction(
    context: simplex::TestContext,
) -> anyhow::Result<()> {
    let signer = context.get_default_signer();
    let initial_amount = 2_000;
    let small_utxos = [1_000, 2_500, 3_000];
    let additional_amount = small_utxos.iter().sum();
    let (fee_collector, asset_id) =
        setup_fee_collector(&context, initial_amount, small_utxos.to_vec())?;

    let utxos_to_deposit = signer.get_utxos_asset(asset_id)?;
    assert_eq!(utxos_to_deposit.len(), small_utxos.len());

    let mut ft = FinalTransaction::new();
    for utxo_to_deposit in utxos_to_deposit {
        add_native_input(&mut ft, utxo_to_deposit);
    }
    fee_collector.attach_deposit(
        &mut ft,
        get_collector_utxo(&context, &fee_collector)?,
        additional_amount,
    );
    signer.broadcast(&ft)?.wait()?;

    check_collector_amount(&context, &fee_collector, initial_amount + additional_amount)?;

    Ok(())
}

#[simplex::test]
fn merges_two_collector_utxos_without_a_key(context: simplex::TestContext) -> anyhow::Result<()> {
    let signer = context.get_default_signer();
    let initial_amount = 3_000;
    let extra_amount = 4_000;
    let (fee_collector, asset_id) =
        setup_fee_collector(&context, initial_amount, vec![extra_amount])?;

    let mut ft = FinalTransaction::new();
    add_native_input(
        &mut ft,
        find_signer_asset_utxo(signer, asset_id, extra_amount)?,
    );
    fee_collector.add_program_output(&mut ft, asset_id, extra_amount);
    signer.broadcast(&ft)?.wait()?;

    let collector_utxos = get_collector_utxos(&context, &fee_collector)?;
    assert_eq!(collector_utxos.len(), 2);

    let merged_amount = initial_amount + extra_amount;
    let mut ft = FinalTransaction::new();
    add_deposit_program_input(
        &mut ft,
        &fee_collector,
        find_utxo_with_amount(&collector_utxos, initial_amount),
        0,
        extra_amount,
    );
    add_deposit_program_input(
        &mut ft,
        &fee_collector,
        find_utxo_with_amount(&collector_utxos, extra_amount),
        0,
        initial_amount,
    );
    fee_collector.add_program_output(&mut ft, asset_id, merged_amount);
    signer.broadcast(&ft)?.wait()?;

    check_collector_amount(&context, &fee_collector, merged_amount)?;

    Ok(())
}

#[simplex::test]
fn recreates_collector_after_full_withdrawal(context: simplex::TestContext) -> anyhow::Result<()> {
    let signer = context.get_default_signer();
    let initial_amount = 3_000;
    let additional_amount = 5_000;
    let (fee_collector, asset_id) =
        setup_fee_collector(&context, initial_amount, vec![additional_amount])?;

    let mut ft = FinalTransaction::new();
    fee_collector.attach_withdrawal(&mut ft, get_collector_utxo(&context, &fee_collector)?);
    add_signer_output(&mut ft, signer, initial_amount, asset_id);
    signer.broadcast(&ft)?.wait()?;
    check_collector_empty(&context, &fee_collector)?;

    let mut ft = FinalTransaction::new();
    add_native_input(
        &mut ft,
        find_signer_asset_utxo(signer, asset_id, initial_amount)?,
    );
    fee_collector.attach_creation(&mut ft, asset_id, initial_amount);
    signer.broadcast(&ft)?.wait()?;
    check_collector_amount(&context, &fee_collector, initial_amount)?;

    deposit_amount(&context, &fee_collector, asset_id, additional_amount)?;
    check_collector_amount(&context, &fee_collector, initial_amount + additional_amount)?;

    Ok(())
}
