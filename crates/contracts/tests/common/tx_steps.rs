#![allow(dead_code)]
use simplex::simplicityhl::elements::Txid;
use simplex::transaction::FinalTransaction;

pub fn finalize_and_broadcast(
    context: &simplex::TestContext,
    ft: &FinalTransaction,
) -> anyhow::Result<Txid> {
    let provider = context.get_provider();
    let signer = context.get_signer();

    let (tx, _) = signer.finalize(ft).unwrap();
    let txid = provider.broadcast_transaction(&tx).unwrap();
    Ok(txid)
}

pub fn finalize_strict_and_broadcast(
    context: &simplex::TestContext,
    ft: &FinalTransaction,
) -> anyhow::Result<Txid> {
    let provider = context.get_provider();
    let signer = context.get_signer();

    let (tx, _) = signer.finalize_strict(ft, 1).unwrap();
    let txid = provider.broadcast_transaction(&tx).unwrap();
    Ok(txid)
}

pub fn wait_for_tx(context: &simplex::TestContext, txid: &Txid) -> anyhow::Result<()> {
    Ok(context.get_provider().wait(txid)?)
}
