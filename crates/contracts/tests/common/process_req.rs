use std::collections::BTreeMap;

use anyhow::{Result, bail};

use simplex::lwk_simplicity::wallet_abi::TxCreateRequest;
use simplex::transaction::UTXO;
use simplex::wallet_abi::{ElementsOutPoint, ElementsTransaction, WalletAbiHarness};

pub struct ProcessedRequest {
    pub tx: ElementsTransaction,
    outputs: BTreeMap<String, UTXO>,
}

impl ProcessedRequest {
    pub fn output(&self, id: &str) -> Result<UTXO> {
        self.outputs
            .get(id)
            .cloned()
            .ok_or_else(|| anyhow::anyhow!("missing output '{id}'"))
    }

    pub fn output_if_present(&self, id: &str) -> Option<UTXO> {
        self.outputs.get(id).cloned()
    }
}

pub(crate) fn process_wallet_abi_request(
    harness: &WalletAbiHarness,
    request: TxCreateRequest,
) -> Result<ProcessedRequest> {
    let outputs = request.params.outputs.clone();
    let tx = harness.process_request(request)?;

    if tx.output.len() < outputs.len() {
        bail!(
            "expected at least {} declared outputs, got {}",
            outputs.len(),
            tx.output.len()
        );
    }

    let mut outputs_by_id = BTreeMap::new();
    for (vout, output) in outputs.into_iter().enumerate() {
        let txout = tx.output[vout].clone();
        let known_utxo = UTXO {
            outpoint: ElementsOutPoint::new(
                tx.txid(),
                u32::try_from(vout).map_err(|error| anyhow::anyhow!(error))?,
            ),
            txout,
            secrets: None,
        };

        if outputs_by_id
            .insert(output.id.clone(), known_utxo)
            .is_some()
        {
            bail!("duplicate output id '{}'", output.id);
        }
    }

    Ok(ProcessedRequest {
        tx,
        outputs: outputs_by_id,
    })
}
