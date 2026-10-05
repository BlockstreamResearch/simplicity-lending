use std::path::Path;
use std::str::FromStr;

use lending_contracts::programs::program::SimplexProgram;
use serde::Deserialize;
use simplex::provider::{EsploraProvider, ProviderError, ProviderTrait};
use simplex::simplicityhl::elements::encode::{deserialize, serialize_hex};
use simplex::simplicityhl::elements::hex::ToHex;
use simplex::simplicityhl::elements::{Script, Transaction, Txid};

use crate::AppContext;
use crate::error::HarvesterError;
use crate::state::{Outpoint, State};

use super::core::{esplora_provider, open_fee_collector};

pub(super) fn settle_pending(
    ctx: &AppContext,
    path: &Path,
    state: &State,
    op: CollectorOp,
) -> Result<PendingOutcome, HarvesterError> {
    let Some(pending_txid) = state.pending_txid.as_deref() else {
        return Ok(PendingOutcome::Ready(state.clone()));
    };
    let txid = Txid::from_str(pending_txid).map_err(|_| HarvesterError::InvalidTxid {
        txid: pending_txid.to_owned(),
    })?;
    let provider = esplora_provider(ctx);
    match tx_presence(&provider, &txid)? {
        TxPresence::InMempool => {
            tracing::info!(
                txid = pending_txid,
                "collector transaction is still in the mempool"
            );
            Ok(PendingOutcome::Waiting)
        }
        TxPresence::Confirmed => apply_confirmation(ctx, path, state, &provider, &txid),
        TxPresence::Absent => settle_absent(path, state, op),
    }
}

fn settle_absent(
    path: &Path,
    state: &State,
    op: CollectorOp,
) -> Result<PendingOutcome, HarvesterError> {
    let txid = state.pending_txid.as_deref().unwrap_or_default();
    if saved_transaction(state)?
        .as_ref()
        .and_then(|transaction| pending_op(state, transaction))
        == Some(op)
    {
        tracing::warn!(
            txid,
            "collector transaction left the mempool; building a replacement"
        );
        return Ok(PendingOutcome::Ready(state.clone()));
    }

    tracing::warn!(txid, "pending collector transaction was dropped");
    finish_drop(path, state)
}

fn apply_confirmation(
    ctx: &AppContext,
    path: &Path,
    state: &State,
    provider: &EsploraProvider,
    txid: &Txid,
) -> Result<PendingOutcome, HarvesterError> {
    let pending_txid = txid.to_string();
    let script = match state.pending_script.as_deref() {
        Some(script) => Script::from_str(script).map_err(|_| HarvesterError::InvalidSetting {
            field: "state.pending_script",
            value: script.to_owned(),
        })?,
        None => open_fee_collector(ctx)?.get_script_pubkey(),
    };
    let outputs = provider.fetch_transaction(txid)?;
    let vouts: Vec<u32> = outputs
        .output
        .iter()
        .enumerate()
        .filter(|(_, output)| output.script_pubkey == script)
        .map(|(index, _)| index as u32)
        .collect();

    match vouts.as_slice() {
        [vout] => {
            let confirmed = State {
                outpoint: Outpoint {
                    txid: pending_txid,
                    vout: *vout,
                },
                pending_txid: None,
                pending_script: None,
                pending_tx: None,
                closed: false,
            };
            confirmed.save(path)?;
            tracing::info!(
                outpoint = %confirmed.outpoint,
                path = %path.display(),
                "collector transaction confirmed"
            );
            Ok(PendingOutcome::Ready(confirmed))
        }
        [] if state.pending_script.is_some() => {
            let closed = clear_pending(state, true);
            closed.save(path)?;
            tracing::info!(
                txid = %pending_txid,
                path = %path.display(),
                "confirmed transaction spent the collector; closed collector state"
            );
            Ok(PendingOutcome::Spent)
        }
        [] => Err(HarvesterError::CollectorScriptMismatch { txid: pending_txid }),
        _ => Err(HarvesterError::CollectorOutputs {
            txid: pending_txid,
            count: vouts.len(),
        }),
    }
}

pub(super) fn publish(
    ctx: &AppContext,
    path: &Path,
    outpoint: Outpoint,
    transaction: &Transaction,
    script_hex: &str,
) -> Result<PendingOutcome, HarvesterError> {
    let previous = State::load(path)?;
    let provider = esplora_provider(ctx);
    let txid = transaction.txid();
    let pending = State {
        outpoint,
        pending_txid: Some(txid.to_string()),
        pending_script: Some(script_hex.to_owned()),
        pending_tx: Some(serialize_hex(transaction)),
        closed: false,
    };
    pending.save(path)?;

    match provider.broadcast_transaction(transaction) {
        Ok(_) => {
            tracing::info!(txid = %txid, "broadcast collector transaction");
            Ok(PendingOutcome::Waiting)
        }
        Err(ProviderError::BroadcastRejected {
            message,
            status,
            url,
        }) => match follow_broadcast(ctx, path, &pending, &provider, &txid, &message)? {
            Followed::Live(outcome) => Ok(outcome),
            Followed::Dropped => {
                restore_live_previous(path, &provider, previous.as_ref(), &pending)?;
                Err(ProviderError::BroadcastRejected {
                    message,
                    status,
                    url,
                }
                .into())
            }
        },
        Err(err) => Err(err.into()),
    }
}

fn restore_live_previous(
    path: &Path,
    provider: &EsploraProvider,
    previous: Option<&State>,
    published: &State,
) -> Result<(), HarvesterError> {
    let Some(previous) = previous else {
        return Ok(());
    };
    let Some(txid) = previous.pending_txid.as_deref() else {
        return Ok(());
    };
    if published.pending_txid.as_deref() == Some(txid) {
        return Ok(());
    }

    let parsed = Txid::from_str(txid).map_err(|_| HarvesterError::InvalidTxid {
        txid: txid.to_owned(),
    })?;
    if tx_presence(provider, &parsed)? == TxPresence::InMempool {
        previous.save(path)?;
        tracing::info!(
            txid,
            "replacement was rejected; kept the collector transaction that is still in the mempool"
        );
    }
    Ok(())
}

fn follow_broadcast(
    ctx: &AppContext,
    path: &Path,
    state: &State,
    provider: &EsploraProvider,
    txid: &Txid,
    message: &str,
) -> Result<Followed, HarvesterError> {
    match tx_presence(provider, txid)? {
        TxPresence::Confirmed => {
            apply_confirmation(ctx, path, state, provider, txid).map(Followed::Live)
        }
        TxPresence::InMempool => {
            tracing::info!(
                txid = %txid,
                "collector transaction is still in the mempool"
            );
            Ok(Followed::Live(PendingOutcome::Waiting))
        }
        TxPresence::Absent if in_flight(message) => {
            tracing::info!(txid = %txid, "collector transaction is already known");
            Ok(Followed::Live(PendingOutcome::Waiting))
        }
        TxPresence::Absent => {
            tracing::warn!(
                txid = %txid,
                reason = %message,
                "pending collector transaction was dropped"
            );
            finish_drop(path, state)?;
            Ok(Followed::Dropped)
        }
    }
}

fn finish_drop(path: &Path, state: &State) -> Result<PendingOutcome, HarvesterError> {
    match pending_drop(state) {
        PendingDrop::Remove => {
            let closed = clear_pending(state, true);
            closed.save(path)?;
            Ok(PendingOutcome::Spent)
        }
        PendingDrop::Keep(cleared) => {
            cleared.save(path)?;
            Ok(PendingOutcome::Ready(cleared))
        }
    }
}

fn pending_drop(state: &State) -> PendingDrop {
    if is_initial_collector_creation(state) {
        PendingDrop::Remove
    } else {
        PendingDrop::Keep(clear_pending(state, false))
    }
}

fn clear_pending(state: &State, closed: bool) -> State {
    State {
        outpoint: state.outpoint.clone(),
        pending_txid: None,
        pending_script: None,
        pending_tx: None,
        closed,
    }
}

pub(super) fn pending_in_mempool(state: &State) -> HarvesterError {
    HarvesterError::PendingInMempool {
        txid: state.pending_txid.clone().unwrap_or_default(),
    }
}

fn decode_raw_transaction(raw: &str, txid: &str) -> Result<Transaction, HarvesterError> {
    let bytes = hex::decode(raw).map_err(|_| HarvesterError::InvalidPendingTx {
        txid: txid.to_owned(),
    })?;
    deserialize(&bytes).map_err(|_| HarvesterError::InvalidPendingTx {
        txid: txid.to_owned(),
    })
}

fn tx_presence(provider: &EsploraProvider, txid: &Txid) -> Result<TxPresence, HarvesterError> {
    let url = format!("{}/tx/{txid}/status", provider.esplora_url);
    let response = minreq::get(url)
        .with_timeout(provider.timeout.as_secs())
        .send()
        .map_err(|err| ProviderError::Request(err.to_string()))?;

    match response.status_code {
        404 => Ok(TxPresence::Absent),
        200 => {
            let status: TxStatus = response
                .json()
                .map_err(|err| ProviderError::Deserialize(err.to_string()))?;
            Ok(if status.confirmed {
                TxPresence::Confirmed
            } else {
                TxPresence::InMempool
            })
        }
        status => {
            Err(ProviderError::Request(format!("HTTP {status}: {}", response.reason_phrase)).into())
        }
    }
}

fn in_flight(message: &str) -> bool {
    let message = message.to_ascii_lowercase();
    message.contains("already in block") || message.contains("already-in-mempool")
}

fn saved_transaction(state: &State) -> Result<Option<Transaction>, HarvesterError> {
    let Some(raw) = state.pending_tx.as_deref() else {
        return Ok(None);
    };
    let txid = state.pending_txid.as_deref().unwrap_or_default();
    decode_raw_transaction(raw, txid).map(Some)
}

fn pending_op(state: &State, transaction: &Transaction) -> Option<CollectorOp> {
    if is_initial_collector_creation(state) {
        return None;
    }
    let script = state.pending_script.as_deref()?;
    let recreates = transaction
        .output
        .iter()
        .any(|output| output.script_pubkey.to_hex() == script);
    Some(if recreates {
        CollectorOp::Harvest
    } else {
        CollectorOp::Withdraw
    })
}

fn is_initial_collector_creation(state: &State) -> bool {
    state.pending_txid.as_deref() == Some(state.outpoint.txid.as_str())
}

pub(super) enum PendingOutcome {
    Ready(State),
    Spent,
    Waiting,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum CollectorOp {
    Harvest,
    Withdraw,
}

enum Followed {
    Live(PendingOutcome),
    Dropped,
}

enum PendingDrop {
    Remove,
    Keep(State),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TxPresence {
    Confirmed,
    InMempool,
    Absent,
}

#[derive(Deserialize)]
struct TxStatus {
    confirmed: bool,
}

#[cfg(test)]
mod tests {
    use std::str::FromStr;

    use simplex::simplicityhl::elements::hex::ToHex;
    use simplex::simplicityhl::elements::{
        LockTime, OutPoint, Script, Sequence, Transaction, TxIn, TxOut, Txid,
    };

    use crate::test_utils::TempDir;

    #[test]
    fn unindexed_reject_filter_is_not_left_in_flight() {
        assert!(super::in_flight("Transaction already in block chain"));
        assert!(super::in_flight("txn-already-in-mempool"));
        assert!(!super::in_flight("txn-already-known"));
        assert!(!super::in_flight("bad-txns-inputs-missingorspent"));
    }

    #[test]
    fn rejected_collector_creation_removes_the_unconfirmed_collector() {
        let txid = "aa".repeat(32);
        let state = crate::state::State {
            outpoint: crate::state::Outpoint {
                txid: txid.clone(),
                vout: 0,
            },
            pending_txid: Some(txid),
            pending_script: Some("51".to_owned()),
            pending_tx: Some("00".to_owned()),
            closed: false,
        };

        assert!(matches!(
            super::pending_drop(&state),
            super::PendingDrop::Remove
        ));
    }

    #[test]
    fn rejected_harvest_keeps_the_previous_pool() {
        let state = crate::state::State {
            outpoint: crate::state::Outpoint {
                txid: "aa".repeat(32),
                vout: 1,
            },
            pending_txid: Some("bb".repeat(32)),
            pending_script: Some("51".to_owned()),
            pending_tx: Some("00".to_owned()),
            closed: false,
        };

        let super::PendingDrop::Keep(cleared) = super::pending_drop(&state) else {
            panic!("harvest outpoint must stay");
        };
        assert_eq!(cleared.outpoint.vout, 1);
        assert!(!cleared.closed);
        assert_eq!(cleared.pending_txid, None);
        assert_eq!(cleared.pending_script, None);
        assert_eq!(cleared.pending_tx, None);
    }

    #[test]
    fn rejected_collector_creation_closes_state_instead_of_deleting_it() {
        let dir = TempDir::new();
        let path = dir.path.join("state.json");
        let txid = "aa".repeat(32);
        let state = collector_state(txid.clone(), 0, Some(txid.clone()), false);

        assert!(matches!(
            super::finish_drop(&path, &state).unwrap(),
            super::PendingOutcome::Spent
        ));

        let stored = crate::state::State::load(&path)
            .unwrap()
            .expect("closed state stays on disk");
        assert!(stored.closed);
        assert_eq!(stored.outpoint.txid, txid);
        assert_eq!(stored.pending_txid, None);
        assert_eq!(stored.pending_script, None);
        assert_eq!(stored.pending_tx, None);
        assert_eq!(
            super::super::core::load_collector_at(&path, &collector_settings(&"11".repeat(32), 3))
                .unwrap(),
            None
        );
    }

    #[test]
    fn rejected_harvest_clears_pending_without_closing_the_pool() {
        let dir = TempDir::new();
        let path = dir.path.join("state.json");
        let state = collector_state("aa".repeat(32), 1, Some("bb".repeat(32)), false);

        let super::PendingOutcome::Ready(cleared) = super::finish_drop(&path, &state).unwrap()
        else {
            panic!("harvest outpoint must stay");
        };

        assert!(!cleared.closed);
        assert_eq!(cleared.outpoint.vout, 1);
        assert_eq!(cleared.pending_txid, None);
        assert_eq!(
            crate::state::State::load(&path).unwrap().as_ref(),
            Some(&cleared)
        );
    }

    #[test]
    fn pending_payload_selects_the_collector_operation() {
        let script = Script::new_op_return(&[1]);
        let harvest = bare_transaction(Sequence::ENABLE_RBF_NO_LOCKTIME, script.clone());
        let state = operation_state(&script.to_hex(), false);

        assert_eq!(
            super::pending_op(&state, &harvest),
            Some(super::CollectorOp::Harvest)
        );
        assert_eq!(
            super::pending_op(&operation_state("51", false), &harvest),
            Some(super::CollectorOp::Withdraw)
        );
        assert_eq!(
            super::pending_op(&operation_state(&script.to_hex(), true), &harvest),
            None
        );
    }

    fn bare_transaction(sequence: Sequence, script: Script) -> Transaction {
        Transaction {
            version: 2,
            lock_time: LockTime::ZERO,
            input: vec![TxIn {
                sequence,
                ..TxIn::default()
            }],
            output: vec![TxOut {
                script_pubkey: script,
                ..TxOut::default()
            }],
        }
    }

    fn operation_state(script: &str, initial_creation: bool) -> crate::state::State {
        let outpoint = "aa".repeat(32);
        let pending = if initial_creation {
            outpoint.clone()
        } else {
            "bb".repeat(32)
        };
        crate::state::State {
            outpoint: crate::state::Outpoint {
                txid: outpoint,
                vout: 1,
            },
            pending_txid: Some(pending),
            pending_script: Some(script.to_owned()),
            pending_tx: None,
            closed: false,
        }
    }

    fn collector_settings(txid: &str, vout: u32) -> crate::config::CollectorSettings {
        crate::config::CollectorSettings {
            withdraw_pubkey: String::new(),
            outpoint: Some(OutPoint {
                txid: Txid::from_str(txid).unwrap(),
                vout,
            }),
        }
    }

    fn collector_state(
        txid: String,
        vout: u32,
        pending_txid: Option<String>,
        closed: bool,
    ) -> crate::state::State {
        crate::state::State {
            outpoint: crate::state::Outpoint { txid, vout },
            pending_script: pending_txid.as_ref().map(|_| "51".to_owned()),
            pending_tx: pending_txid.as_ref().map(|_| "00".to_owned()),
            pending_txid,
            closed,
        }
    }
}
