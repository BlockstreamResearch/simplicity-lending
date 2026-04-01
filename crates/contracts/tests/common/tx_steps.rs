#![allow(dead_code)]
use simplex::simplicityhl::elements::Txid;
use simplex::transaction::FinalTransaction;

pub fn finalize_and_broadcast(
    context: &simplex::TestContext,
    ft: &FinalTransaction,
) -> anyhow::Result<Txid> {
    let provider = context.get_default_provider();
    let signer = context.get_default_signer();

    let (tx, _) = signer.finalize(ft).unwrap();
    let txid = provider.broadcast_transaction(&tx).unwrap();
    Ok(txid)
}

pub fn finalize_strict_and_broadcast(
    context: &simplex::TestContext,
    ft: &FinalTransaction,
) -> anyhow::Result<Txid> {
    let provider = context.get_default_provider();
    let signer = context.get_default_signer();

    let (tx, _) = signer.finalize_strict(ft, 1).unwrap();
    let txid = provider.broadcast_transaction(&tx).unwrap();
    Ok(txid)
}

pub fn wait_for_tx(context: &simplex::TestContext, txid: &Txid) -> anyhow::Result<()> {
    Ok(context.get_default_provider().wait(txid)?)
}

pub fn mine_blocks_with_self_send(
    context: &simplex::TestContext,
    blocks: u32,
    amount: u64,
) -> anyhow::Result<Vec<Txid>> {
    let provider = context.get_default_provider();
    let signer = context.get_default_signer();

    let mut txids = Vec::with_capacity(blocks as usize);
    let recipient_script = signer.get_address()?.script_pubkey();

    for _ in 0..blocks {
        let txid = signer.send(recipient_script.clone(), amount)?;
        provider.wait(&txid)?;
        txids.push(txid);
    }

    Ok(txids)
}
