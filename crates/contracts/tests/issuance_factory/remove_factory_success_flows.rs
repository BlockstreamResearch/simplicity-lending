use lending_contracts::programs::program::SimplexProgram;

use simplex::transaction::FinalTransaction;

use super::common::tx_steps::finalize_and_broadcast;
use super::setup::setup_issuance_factory;

#[simplex::test]
fn removes_issuance_factory_correctly(context: simplex::TestContext) -> anyhow::Result<()> {
    let provider = context.get_default_provider();

    let (issuance_factory, _) = setup_issuance_factory(&context, 2, 0)?;

    let mut ft = FinalTransaction::new();

    let issuance_factory_utxo =
        provider.fetch_scripthash_utxos(&issuance_factory.get_script_pubkey())?[0].clone();

    issuance_factory.attach_factory_removing(&mut ft, issuance_factory_utxo);

    let txid = finalize_and_broadcast(&context, &ft)?;
    provider.wait(&txid)?;

    Ok(())
}
