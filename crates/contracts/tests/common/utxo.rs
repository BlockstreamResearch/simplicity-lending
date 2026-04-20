use anyhow::{Result, anyhow};
use simplex::{
    simplicityhl::elements::{OutPoint, Txid},
    transaction::UTXO,
};

pub fn fetch_output_utxo(context: &simplex::TestContext, txid: Txid, vout: u32) -> Result<UTXO> {
    let tx = context.get_default_provider().fetch_transaction(&txid)?;
    let txout = tx
        .output
        .get(vout as usize)
        .cloned()
        .ok_or_else(|| anyhow!("missing tx output {txid}:{vout}"))?;

    Ok(UTXO {
        outpoint: OutPoint::new(txid, vout),
        txout,
        secrets: None,
    })
}
