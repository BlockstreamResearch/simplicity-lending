use std::path::Path;

use lending_contracts::programs::program::SimplexProgram;
use serde::Deserialize;
use simplex::provider::{EsploraProvider, ProviderError, ProviderTrait};
use simplex::simplicityhl::elements::{OutPoint, Transaction, Txid};

use crate::AppContext;
use crate::error::HarvesterError;
use crate::state::State;

use super::core::{esplora_provider, open_fee_collector};

pub(super) fn settle_pending(
    ctx: &AppContext,
    path: &Path,
    state: Option<State>,
) -> Result<Option<State>, HarvesterError> {
    let Some(mut state) = state else {
        return Ok(None);
    };
    let Some(txid) = state.pending_txid else {
        return Ok(state.outpoint.is_some().then_some(state));
    };
    let provider = esplora_provider(ctx);

    match transaction_status(&provider, &txid)? {
        Some(false) => Err(HarvesterError::PendingInMempool {
            txid: txid.to_string(),
        }),
        Some(true) => confirm(ctx, path, &provider, &txid, state.pending_collector_output),
        None => {
            tracing::warn!(%txid, "collector transaction left the mempool");
            state.pending_txid = None;
            state.pending_collector_output = false;
            if state.outpoint.is_some() {
                state.save(path)?;
                Ok(Some(state))
            } else {
                State::remove(path)?;
                Ok(None)
            }
        }
    }
}

pub(super) fn publish(
    ctx: &AppContext,
    path: &Path,
    previous: Option<&State>,
    transaction: &Transaction,
    keeps_collector: bool,
) -> Result<(), HarvesterError> {
    let txid = transaction.txid();
    let pending = State {
        outpoint: previous.and_then(|state| state.outpoint),
        pending_txid: Some(txid),
        pending_collector_output: keeps_collector,
    };
    pending.save(path)?;

    esplora_provider(ctx).broadcast_transaction(transaction)?;
    tracing::info!(%txid, "broadcast collector transaction");
    Ok(())
}

fn confirm(
    ctx: &AppContext,
    path: &Path,
    provider: &EsploraProvider,
    txid: &Txid,
    expects_collector: bool,
) -> Result<Option<State>, HarvesterError> {
    let script = open_fee_collector(ctx)?.get_script_pubkey();
    let transaction = provider.fetch_transaction(txid)?;
    let outputs: Vec<_> = transaction
        .output
        .iter()
        .enumerate()
        .filter(|(_, output)| output.script_pubkey == script)
        .map(|(index, _)| index as u32)
        .collect();

    match outputs.as_slice() {
        [vout] => {
            let state = State {
                outpoint: Some(OutPoint {
                    txid: *txid,
                    vout: *vout,
                }),
                pending_txid: None,
                pending_collector_output: false,
            };
            state.save(path)?;
            tracing::info!(outpoint = %state.outpoint.as_ref().expect("collector output"), "collector transaction confirmed");
            Ok(Some(state))
        }
        [] if !expects_collector => {
            State::remove(path)?;
            tracing::info!(%txid, "withdrawal transaction confirmed");
            Ok(None)
        }
        [] => Err(HarvesterError::CollectorScriptMismatch {
            txid: txid.to_string(),
        }),
        _ => Err(HarvesterError::CollectorOutputs {
            txid: txid.to_string(),
            count: outputs.len(),
        }),
    }
}

fn transaction_status(
    provider: &EsploraProvider,
    txid: &Txid,
) -> Result<Option<bool>, HarvesterError> {
    let url = format!("{}/tx/{txid}/status", provider.esplora_url);
    let response = minreq::get(url)
        .with_timeout(provider.timeout.as_secs())
        .send()
        .map_err(|err| ProviderError::Request(err.to_string()))?;

    match response.status_code {
        404 => Ok(None),
        200 => response
            .json::<TxStatus>()
            .map(|status| Some(status.confirmed))
            .map_err(|err| ProviderError::Deserialize(err.to_string()).into()),
        status => {
            Err(ProviderError::Request(format!("HTTP {status}: {}", response.reason_phrase)).into())
        }
    }
}

#[derive(Deserialize)]
struct TxStatus {
    confirmed: bool,
}

#[cfg(test)]
mod tests {
    use std::str::FromStr;

    use simplex::simplicityhl::elements::{OutPoint, Txid};

    use crate::state::State;
    use crate::test_utils::TempDir;

    #[test]
    fn dropped_first_harvest_removes_pending_state() {
        let dir = TempDir::new();
        let path = dir.path.join("state.json");
        State {
            outpoint: None,
            pending_txid: Some(Txid::from_str(&"aa".repeat(32)).unwrap()),
            pending_collector_output: true,
        }
        .save(&path)
        .unwrap();

        State::remove(&path).unwrap();
        assert_eq!(State::load(&path).unwrap(), None);
    }

    #[test]
    fn dropped_deposit_keeps_the_previous_collector() {
        let previous = State {
            outpoint: Some(OutPoint {
                txid: Txid::from_str(&"aa".repeat(32)).unwrap(),
                vout: 1,
            }),
            pending_txid: Some(Txid::from_str(&"bb".repeat(32)).unwrap()),
            pending_collector_output: true,
        };

        let restored = State {
            pending_txid: None,
            pending_collector_output: false,
            ..previous
        };
        assert_eq!(restored.outpoint.as_ref().unwrap().vout, 1);
        assert_eq!(restored.pending_txid, None);
    }
}
