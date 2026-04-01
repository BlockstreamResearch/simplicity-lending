use simplex::simplicityhl::elements::OutPoint;

use crate::lending_tests::support::repay_lending_tx;

use super::support::setup_lending_fixture;

#[simplex::test]
fn loan_repayment_flow(context: simplex::TestContext) -> anyhow::Result<()> {
    let provider = context.get_default_provider();
    let fixture = setup_lending_fixture(&context)?;

    provider.wait(&fixture.lending_txid)?;

    let txid = repay_lending_tx(&context, fixture.lending, fixture.lending_txid)?;

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
