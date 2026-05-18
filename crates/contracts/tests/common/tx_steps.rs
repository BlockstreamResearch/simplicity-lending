#![allow(dead_code)]
use simplex::simplicityhl::elements::Txid;
use simplex::transaction::FinalTransaction;

pub fn finalize_strict_and_broadcast(
    context: &simplex::TestContext,
    ft: &FinalTransaction,
) -> anyhow::Result<Txid> {
    let provider = context.get_default_provider();
    let signer = context.get_default_signer();

    let (tx, _) = signer.finalize_strict(ft, 1)?;
    let receipt = provider.broadcast_transaction(&tx)?;
    Ok(receipt.txid())
}

pub fn wait_for_tx(context: &simplex::TestContext, txid: &Txid) -> anyhow::Result<()> {
    Ok(context.get_default_provider().wait(txid)?)
}

// pub fn mine_blocks_with_self_send(
//     context: &simplex::TestContext,
//     blocks: u32,
//     amount: u64,
// ) -> anyhow::Result<Vec<Txid>> {
//     let signer = context.get_default_signer();

//     let mut txids = Vec::with_capacity(blocks as usize);
//     let recipient_script = signer.get_address().script_pubkey();

//     for _ in 0..blocks {
//         let receipt = signer.send(recipient_script.clone(), amount)?;
//         receipt.wait()?;
//         txids.push(receipt.txid());
//     }

//     Ok(txids)
// }
