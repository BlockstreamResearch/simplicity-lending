use simplex::simplicityhl::elements::OutPoint;

use crate::common::tx_steps::finalize_strict_and_broadcast;

use super::support::{get_lending_liquidation_tx, mine_until_height, setup_lending_fixture};

#[simplex::test]
fn happy_liquidation_flow(context: simplex::TestContext) -> anyhow::Result<()> {
    let provider = context.get_default_provider();
    let fixture = setup_lending_fixture(&context)?;

    provider.wait(&fixture.lending_txid)?;

    let lending_parameters = fixture.lending.get_lending_parameters();
    mine_until_height(
        &context,
        lending_parameters.offer_parameters.loan_expiration_time + 1,
    )?;

    println!("Current height - {}", provider.fetch_tip_height()?);

    let ft = get_lending_liquidation_tx(&context, fixture.lending, fixture.lending_txid)?;
    let txid = finalize_strict_and_broadcast(&context, &ft)?;

    provider.wait(&txid)?;

    let collateral_outpoint = OutPoint::new(txid, 0);
    let signer_collateral_utxos = context
        .get_default_signer()
        .get_utxos_filter(&|utxo| utxo.outpoint == collateral_outpoint, &|_| true)?;

    assert!(
        signer_collateral_utxos.len() == 1,
        "Failed to find collateral UTXO"
    );

    Ok(())
}

#[simplex::test]
fn failed_liquidation_flow(context: simplex::TestContext) -> anyhow::Result<()> {
    let provider = context.get_default_provider();
    let signer = context.get_default_signer();
    let fixture = setup_lending_fixture(&context)?;

    provider.wait(&fixture.lending_txid)?;

    let lending_parameters = fixture.lending.get_lending_parameters();

    assert!(
        provider.fetch_tip_height()? < lending_parameters.offer_parameters.loan_expiration_time
    );

    let ft = get_lending_liquidation_tx(&context, fixture.lending, fixture.lending_txid)?;

    let (tx, _) = signer.finalize_strict(&ft, 1).unwrap();
    let result = provider.broadcast_transaction(&tx);

    assert!(
        result.is_err(),
        "Expected liquidation to fail but it succeeded"
    );

    Ok(())
}
