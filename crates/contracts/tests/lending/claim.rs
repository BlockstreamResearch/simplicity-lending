use simplex::simplicityhl::elements::OutPoint;

use crate::lending_tests::support::{claim_lender_principal, repay_lending_tx};

use super::support::setup_lending_fixture;

#[simplex::test]
fn lender_principal_claim_flow(context: simplex::TestContext) -> anyhow::Result<()> {
    let provider = context.get_provider();
    let fixture = setup_lending_fixture(&context)?;

    provider.wait(&fixture.lending_txid)?;

    let lending_parameters = fixture.lending.get_lending_parameters().clone();
    let txid = repay_lending_tx(&context, fixture.lending, fixture.lending_txid)?;

    provider.wait(&txid)?;

    let txid = claim_lender_principal(&context, &lending_parameters, txid)?;

    provider.wait(&txid)?;

    let principal_outpoint = OutPoint::new(txid, 0);
    let signer_principal_utxos = context
        .get_signer()
        .get_wpkh_utxos_filter(|utxo| utxo.0 == principal_outpoint)?;

    assert!(
        signer_principal_utxos.len() == 1,
        "Failed to find claimed principal UTXO"
    );

    Ok(())
}
