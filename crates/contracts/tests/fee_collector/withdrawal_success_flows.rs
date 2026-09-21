use simplex::transaction::FinalTransaction;

use super::setup::{
    add_signer_output, check_collector_amount, check_collector_empty, deposit_amount,
    find_signer_asset_utxo, get_collector_utxo, setup_fee_collector,
};

#[simplex::test]
fn withdraws_collected_funds_with_owner_key(context: simplex::TestContext) -> anyhow::Result<()> {
    let signer = context.get_default_signer();
    let initial_amount = 7_000;
    let (fee_collector, asset_id) = setup_fee_collector(&context, initial_amount, vec![])?;

    let mut ft = FinalTransaction::new();
    fee_collector.attach_withdrawal(&mut ft, get_collector_utxo(&context, &fee_collector)?);
    add_signer_output(&mut ft, signer, initial_amount, asset_id);
    signer.broadcast(&ft)?.wait()?;

    check_collector_empty(&context, &fee_collector)?;
    find_signer_asset_utxo(signer, asset_id, initial_amount)?;

    Ok(())
}

#[simplex::test]
fn withdraws_funds_after_deposit(context: simplex::TestContext) -> anyhow::Result<()> {
    let signer = context.get_default_signer();
    let initial_amount = 3_000;
    let additional_amount = 5_000;
    let total_amount = initial_amount + additional_amount;
    let (fee_collector, asset_id) =
        setup_fee_collector(&context, initial_amount, vec![additional_amount])?;

    deposit_amount(&context, &fee_collector, asset_id, additional_amount)?;
    check_collector_amount(&context, &fee_collector, total_amount)?;

    let mut ft = FinalTransaction::new();
    fee_collector.attach_withdrawal(&mut ft, get_collector_utxo(&context, &fee_collector)?);
    add_signer_output(&mut ft, signer, total_amount, asset_id);
    signer.broadcast(&ft)?.wait()?;

    check_collector_empty(&context, &fee_collector)?;
    find_signer_asset_utxo(signer, asset_id, total_amount)?;

    Ok(())
}
