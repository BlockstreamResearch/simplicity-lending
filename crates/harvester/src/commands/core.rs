use std::path::Path;
use std::str::FromStr;

use lending_contracts::programs::fee_collector::{FeeCollector, FeeCollectorParameters};
use lending_contracts::programs::program::SimplexProgram;
use simplex::provider::EsploraProvider;
use simplex::signer::{Signer, SignerError};
use simplex::simplicityhl::elements::hex::ToHex;
use simplex::simplicityhl::elements::secp256k1_zkp::XOnlyPublicKey;
use simplex::simplicityhl::elements::{AssetId, OutPoint, Transaction, Txid};
use simplex::transaction::UTXO;

use super::pending::{CollectorOp, PendingOutcome, pending_in_mempool, publish, settle_pending};
use super::tx::{
    INITIAL_COLLECTOR_AMOUNT, destination_script, finalize_collector_creation, finalize_withdrawal,
    prepare_harvest,
};
use crate::AppContext;
use crate::config::CollectorSettings;
use crate::error::HarvesterError;
use crate::state::{Outpoint, State, StateLock};
use crate::vaults;

pub async fn run(ctx: &AppContext) -> Result<(), HarvesterError> {
    let interval = ctx.harvest_interval();
    tracing::info!(interval_secs = interval.as_secs(), "starting harvest loop");

    loop {
        if let Err(error) = harvest(ctx).await {
            match error {
                HarvesterError::PendingInMempool { txid } => {
                    tracing::warn!(%txid, "collector transaction is still in the mempool");
                }
                error => tracing::error!(error = %error, "harvest failed"),
            }
        }
        tokio::time::sleep(interval).await;
    }
}

pub async fn harvest(ctx: &AppContext) -> Result<(), HarvesterError> {
    let path = crate::state_path();
    let _lock = StateLock::lock(&path)?;
    let collector = match ensure_collector(ctx, &path)? {
        CollectorStatus::Ready(state) => state,
        CollectorStatus::Pending => return Ok(()),
    };

    let vaults = vaults::fetch_claimable_vaults(ctx).await?;

    tracing::info!(
        principal_asset = %ctx.settings.principal_asset,
        total_count = vaults.total_count,
        total_amount = %vaults.total_amount,
        fetched = vaults.items.len(),
        "fetched protocol-fee vaults"
    );

    let amounts = vaults
        .items
        .iter()
        .map(vaults::parse_amount)
        .collect::<Result<Vec<_>, _>>()?;
    let Some((batch, collector)) =
        prepare_harvest(ctx, &path, &collector, &vaults.items, &amounts)?
    else {
        tracing::info!("no protocol-fee batch");
        return Ok(());
    };

    tracing::info!(
        selected = batch.count,
        total_amount = batch.total_amount,
        tx_fee = batch.tx_fee,
        "selected protocol-fee batch"
    );

    submit_harvest(
        ctx,
        &path,
        &collector,
        batch.transaction,
        batch.total_amount,
    )
}

fn ensure_collector(ctx: &AppContext, path: &Path) -> Result<CollectorStatus, HarvesterError> {
    let Some(state) = load_collector(ctx)? else {
        return create_collector(ctx, path);
    };

    match settle_pending(ctx, path, &state, CollectorOp::Harvest)? {
        PendingOutcome::Ready(state) => {
            tracing::info!(
                path = %path.display(),
                outpoint = %state.outpoint,
                "loaded collector state"
            );
            Ok(CollectorStatus::Ready(state))
        }
        PendingOutcome::Waiting => Err(pending_in_mempool(&state)),
        PendingOutcome::Spent => create_collector(ctx, path),
    }
}

fn create_collector(ctx: &AppContext, path: &Path) -> Result<CollectorStatus, HarvesterError> {
    let network = ctx.settings.esplora.simplicity_network();
    let principal_asset = parse_asset_id("principal_asset", &ctx.settings.principal_asset)?;
    let signer = harvest_signer(ctx)?;

    let funding_utxos = signer.get_utxos_asset(principal_asset)?;
    let total_amount = funding_utxos
        .iter()
        .try_fold(0u64, |acc, utxo| acc.checked_add(utxo.amount()))
        .ok_or(HarvesterError::AmountOverflow)?;

    if total_amount < INITIAL_COLLECTOR_AMOUNT {
        return Err(HarvesterError::NoCollectorFunds {
            principal_asset: ctx.settings.principal_asset.clone(),
        });
    }

    let fee_collector = open_fee_collector(ctx)?;
    let (transaction, pool_amount) = finalize_collector_creation(
        &signer,
        &fee_collector,
        principal_asset,
        network.policy_asset(),
        &ctx.settings.principal_asset,
        &funding_utxos,
    )?;
    let script = fee_collector.get_script_pubkey().to_hex();
    let txid = transaction.txid().to_string();

    match publish(
        ctx,
        path,
        Outpoint {
            txid: txid.clone(),
            vout: 0,
        },
        &transaction,
        &script,
    )? {
        PendingOutcome::Ready(state) => {
            tracing::info!(
                outpoint = %state.outpoint,
                pool_amount,
                path = %path.display(),
                "created fee collector"
            );
            Ok(CollectorStatus::Ready(state))
        }
        PendingOutcome::Waiting => {
            tracing::info!(
                %txid,
                pool_amount,
                path = %path.display(),
                "created fee collector; awaiting confirmation"
            );
            Ok(CollectorStatus::Pending)
        }
        PendingOutcome::Spent => Err(HarvesterError::CollectorOutputs { txid, count: 0 }),
    }
}

pub async fn withdraw(ctx: &AppContext, to: Option<&str>) -> Result<(), HarvesterError> {
    let destination = destination_script(ctx, to)?;
    let path = crate::state_path();
    let _lock = StateLock::lock(&path)?;
    let state = match load_collector(ctx)? {
        None => return Err(HarvesterError::NoCollector { path }),
        Some(state) => match settle_pending(ctx, &path, &state, CollectorOp::Withdraw)? {
            PendingOutcome::Ready(state) => state,
            PendingOutcome::Waiting => return Err(pending_in_mempool(&state)),
            PendingOutcome::Spent => return Ok(()),
        },
    };

    let signer = withdraw_signer(ctx)?;
    let collector = open_fee_collector(ctx)?;
    let (collector_utxo, state) = collector_utxo(&path, &signer, &collector, &state)?;
    let (transaction, amount) =
        finalize_withdrawal(&signer, &collector, collector_utxo, destination)?;
    let pending_script = collector.get_script_pubkey().to_hex();
    tracing::info!(txid = %transaction.txid(), amount, "submitting withdrawal");

    match publish(ctx, &path, state.outpoint, &transaction, &pending_script)? {
        PendingOutcome::Spent | PendingOutcome::Waiting => Ok(()),
        PendingOutcome::Ready(_) => Err(HarvesterError::CollectorOutputs {
            txid: transaction.txid().to_string(),
            count: 1,
        }),
    }
}

fn submit_harvest(
    ctx: &AppContext,
    path: &Path,
    state: &State,
    transaction: Transaction,
    total_amount: u64,
) -> Result<(), HarvesterError> {
    let pending_script = open_fee_collector(ctx)?.get_script_pubkey().to_hex();
    match publish(
        ctx,
        path,
        state.outpoint.clone(),
        &transaction,
        &pending_script,
    )? {
        PendingOutcome::Ready(confirmed) => {
            tracing::info!(
                outpoint = %confirmed.outpoint,
                total_amount,
                path = %path.display(),
                "harvest transaction confirmed"
            );
            Ok(())
        }
        PendingOutcome::Waiting => Ok(()),
        PendingOutcome::Spent => Err(HarvesterError::CollectorOutputs {
            txid: transaction.txid().to_string(),
            count: 0,
        }),
    }
}

pub(super) fn collector_utxo(
    path: &Path,
    signer: &Signer,
    collector: &FeeCollector,
    state: &State,
) -> Result<(UTXO, State), HarvesterError> {
    let utxos = signer
        .get_provider()?
        .fetch_scripthash_utxos(&collector.get_script_pubkey())?;
    let utxo = select_collector_utxo(state, utxos)?;
    let state = sync_collector_outpoint(path, state, &utxo.outpoint)?;
    Ok((utxo, state))
}

fn select_collector_utxo(state: &State, mut utxos: Vec<UTXO>) -> Result<UTXO, HarvesterError> {
    let saved = parse_outpoint(&state.outpoint.txid, state.outpoint.vout)?;
    if let Some(position) = utxos.iter().position(|utxo| utxo.outpoint == saved) {
        return Ok(utxos.swap_remove(position));
    }

    let outpoint = state.outpoint.to_string();
    if let Some(txid) = state.pending_txid.clone() {
        return Err(HarvesterError::PendingCollectorOutpoint { outpoint, txid });
    }

    match utxos.len() {
        1 => Ok(utxos.swap_remove(0)),
        0 => Err(HarvesterError::MissingCollectorUtxo { outpoint }),
        count => Err(HarvesterError::AmbiguousCollectorUtxo { outpoint, count }),
    }
}

fn sync_collector_outpoint(
    path: &Path,
    state: &State,
    chosen: &OutPoint,
) -> Result<State, HarvesterError> {
    let saved = parse_outpoint(&state.outpoint.txid, state.outpoint.vout)?;
    if saved == *chosen {
        return Ok(state.clone());
    }

    let updated = State {
        outpoint: Outpoint {
            txid: chosen.txid.to_string(),
            vout: chosen.vout,
        },
        ..state.clone()
    };
    updated.save(path)?;
    tracing::info!(
        previous = %state.outpoint,
        outpoint = %updated.outpoint,
        "collector outpoint moved to the only unspent collector UTXO"
    );
    Ok(updated)
}

pub(super) fn esplora_provider(ctx: &AppContext) -> EsploraProvider {
    EsploraProvider::new(
        ctx.settings.esplora.base_url.clone(),
        ctx.settings.esplora.simplicity_network(),
    )
}

fn signer(ctx: &AppContext, mnemonic: &str, field: &'static str) -> Result<Signer, HarvesterError> {
    let mnemonic = validate_mnemonic(field, mnemonic)?;
    Ok(Signer::new(&mnemonic, Box::new(esplora_provider(ctx))))
}

fn validate_mnemonic(field: &'static str, mnemonic: &str) -> Result<String, HarvesterError> {
    let mnemonic = mnemonic.trim();
    if bip39::Mnemonic::parse(mnemonic).is_err() {
        return Err(HarvesterError::InvalidMnemonic { field });
    }
    Ok(mnemonic.to_owned())
}

pub(super) fn signer_error(wallet: &'static str, err: SignerError) -> HarvesterError {
    match err {
        SignerError::NotEnoughFunds(required_fee) => HarvesterError::InsufficientFeeFunds {
            wallet,
            required_fee,
        },
        err => err.into(),
    }
}

pub(super) fn harvest_signer(ctx: &AppContext) -> Result<Signer, HarvesterError> {
    signer(ctx, &ctx.settings.harvest.mnemonic, "harvest.mnemonic")
}

fn withdraw_signer(ctx: &AppContext) -> Result<Signer, HarvesterError> {
    signer(ctx, &ctx.settings.withdraw.mnemonic, "withdraw.mnemonic")
}

pub(super) fn open_fee_collector(ctx: &AppContext) -> Result<FeeCollector, HarvesterError> {
    Ok(FeeCollector::new(FeeCollectorParameters {
        withdrawal_pubkey: parse_withdrawal_pubkey(&ctx.settings.collector.withdraw_pubkey)?,
        network: ctx.settings.esplora.simplicity_network(),
    }))
}

pub(super) fn parse_outpoint(txid: &str, vout: u32) -> Result<OutPoint, HarvesterError> {
    let txid = Txid::from_str(txid).map_err(|_| HarvesterError::InvalidTxid {
        txid: txid.to_owned(),
    })?;
    Ok(OutPoint { txid, vout })
}

pub(super) fn parse_vault_asset(
    offer_id: &str,
    field: &'static str,
    value: &str,
) -> Result<AssetId, HarvesterError> {
    AssetId::from_str(value).map_err(|_| HarvesterError::InvalidVaultField {
        offer_id: offer_id.to_owned(),
        field,
        value: value.to_owned(),
    })
}

pub(super) fn parse_vault_u64(
    offer_id: &str,
    field: &'static str,
    value: &str,
) -> Result<u64, HarvesterError> {
    value
        .parse()
        .map_err(|_| HarvesterError::InvalidVaultField {
            offer_id: offer_id.to_owned(),
            field,
            value: value.to_owned(),
        })
}

pub(super) fn parse_asset_id(field: &'static str, value: &str) -> Result<AssetId, HarvesterError> {
    AssetId::from_str(value).map_err(|_| HarvesterError::InvalidSetting {
        field,
        value: value.to_owned(),
    })
}

fn parse_withdrawal_pubkey(value: &str) -> Result<XOnlyPublicKey, HarvesterError> {
    XOnlyPublicKey::from_str(value).map_err(|_| HarvesterError::InvalidSetting {
        field: "collector.withdraw_pubkey",
        value: value.to_owned(),
    })
}

fn load_collector(ctx: &AppContext) -> Result<Option<State>, HarvesterError> {
    load_collector_at(&crate::state_path(), &ctx.settings.collector)
}

pub(super) fn load_collector_at(
    path: &Path,
    collector: &CollectorSettings,
) -> Result<Option<State>, HarvesterError> {
    match State::load(path)? {
        Some(state) if state.closed => Ok(None),
        Some(state) => Ok(Some(state)),
        None => Ok(configured_collector(collector)),
    }
}

fn configured_collector(collector: &CollectorSettings) -> Option<State> {
    let outpoint = collector.outpoint?;
    Some(State {
        outpoint: Outpoint {
            txid: outpoint.txid.to_string(),
            vout: outpoint.vout,
        },
        pending_txid: None,
        pending_script: None,
        pending_tx: None,
        closed: false,
    })
}

enum CollectorStatus {
    Ready(State),
    Pending,
}

#[cfg(test)]
mod tests {
    use std::str::FromStr;

    use simplex::signer::SignerError;
    use simplex::simplicityhl::elements::{OutPoint, TxOut, Txid};
    use simplex::transaction::UTXO;

    use super::signer_error;
    use crate::error::HarvesterError;
    use crate::test_utils::TempDir;

    #[test]
    fn not_enough_funds_reports_the_required_fee() {
        let error = signer_error("harvest", SignerError::NotEnoughFunds(1_500));

        assert!(matches!(
            error,
            HarvesterError::InsufficientFeeFunds {
                wallet: "harvest",
                required_fee: 1_500,
            }
        ));
    }

    #[test]
    fn empty_mnemonic_is_a_configuration_error() {
        assert!(matches!(
            super::validate_mnemonic("harvest.mnemonic", "   "),
            Err(HarvesterError::InvalidMnemonic {
                field: "harvest.mnemonic",
            })
        ));
    }

    #[test]
    fn valid_mnemonic_is_accepted() {
        let mnemonic = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
        assert_eq!(
            super::validate_mnemonic("harvest.mnemonic", mnemonic).unwrap(),
            mnemonic
        );
    }

    #[test]
    fn configured_outpoint_becomes_collector_state() {
        let txid = "11".repeat(32);
        let collector = crate::config::CollectorSettings {
            withdraw_pubkey: String::new(),
            outpoint: Some(outpoint(&txid, 2)),
        };

        let state = super::configured_collector(&collector).expect("configured outpoint");

        assert_eq!(state.outpoint.txid, txid);
        assert_eq!(state.outpoint.vout, 2);
        assert_eq!(state.pending_txid, None);
    }

    #[test]
    fn saved_collector_utxo_wins_over_other_script_utxos() {
        let saved = "aa".repeat(32);
        let state = collector_state(saved.clone(), 1, None, false);

        let selected = super::select_collector_utxo(
            &state,
            vec![utxo_at(&"bb".repeat(32), 0), utxo_at(&saved, 1)],
        )
        .unwrap();

        assert_eq!(selected.outpoint, outpoint(&saved, 1));
    }

    #[test]
    fn spent_collector_outpoint_follows_the_only_remaining_utxo() {
        let dir = TempDir::new();
        let path = dir.path.join("state.json");
        let saved = "aa".repeat(32);
        let moved = "bb".repeat(32);
        let state = collector_state(saved, 0, None, false);
        let selected = super::select_collector_utxo(&state, vec![utxo_at(&moved, 3)]).unwrap();
        let stored = super::sync_collector_outpoint(&path, &state, &selected.outpoint).unwrap();

        assert_eq!(stored.outpoint.txid, moved);
        assert_eq!(stored.outpoint.vout, 3);
        assert!(!stored.closed);
        assert_eq!(stored.pending_txid, None);
        assert_eq!(
            crate::state::State::load(&path).unwrap().as_ref(),
            Some(&stored)
        );

        let again = super::select_collector_utxo(
            &stored,
            vec![utxo_at(&moved, 3), utxo_at(&"cc".repeat(32), 0)],
        )
        .unwrap();
        assert_eq!(again.outpoint, outpoint(&moved, 3));
    }

    #[test]
    fn spent_collector_outpoint_with_no_utxo_is_an_error() {
        let state = collector_state("aa".repeat(32), 0, None, false);

        assert!(matches!(
            super::select_collector_utxo(&state, Vec::new()),
            Err(HarvesterError::MissingCollectorUtxo { .. })
        ));
    }

    #[test]
    fn spent_collector_outpoint_with_several_utxos_is_an_error() {
        let state = collector_state("aa".repeat(32), 0, None, false);

        assert!(matches!(
            super::select_collector_utxo(
                &state,
                vec![utxo_at(&"bb".repeat(32), 0), utxo_at(&"cc".repeat(32), 1)],
            ),
            Err(HarvesterError::AmbiguousCollectorUtxo { count: 2, .. })
        ));
    }

    #[test]
    fn pending_collector_does_not_follow_a_foreign_utxo() {
        let saved = "aa".repeat(32);
        let pending = "bb".repeat(32);
        let state = collector_state(saved.clone(), 1, Some(pending.clone()), false);

        let kept = super::select_collector_utxo(
            &state,
            vec![utxo_at(&"cc".repeat(32), 0), utxo_at(&saved, 1)],
        )
        .unwrap();
        assert_eq!(kept.outpoint, outpoint(&saved, 1));

        assert!(matches!(
            super::select_collector_utxo(&state, vec![utxo_at(&"cc".repeat(32), 4)]),
            Err(HarvesterError::PendingCollectorOutpoint { txid, .. }) if txid == pending
        ));
    }

    #[test]
    fn matching_collector_outpoint_is_not_rewritten() {
        let dir = TempDir::new();
        let path = dir.path.join("state.json");
        let saved = "aa".repeat(32);
        let state = collector_state(saved.clone(), 2, None, false);

        let stored = super::sync_collector_outpoint(&path, &state, &outpoint(&saved, 2)).unwrap();

        assert_eq!(stored, state);
        assert!(!path.exists());
    }

    #[test]
    fn closed_state_file_ignores_the_configured_outpoint() {
        let dir = TempDir::new();
        let path = dir.path.join("state.json");
        let yaml_txid = "11".repeat(32);
        collector_state("22".repeat(32), 0, None, true)
            .save(&path)
            .unwrap();

        assert_eq!(
            super::load_collector_at(&path, &collector_settings(&yaml_txid, 4)).unwrap(),
            None
        );
    }

    #[test]
    fn missing_state_file_uses_the_configured_outpoint() {
        let dir = TempDir::new();
        let path = dir.path.join("state.json");
        let txid = "11".repeat(32);

        let state = super::load_collector_at(&path, &collector_settings(&txid, 2))
            .unwrap()
            .expect("yaml outpoint");

        assert_eq!(state.outpoint.txid, txid);
        assert_eq!(state.outpoint.vout, 2);
        assert!(!state.closed);
        assert!(!path.exists());
    }

    #[test]
    fn open_state_file_wins_over_the_configured_outpoint() {
        let dir = TempDir::new();
        let path = dir.path.join("state.json");
        let file_txid = "22".repeat(32);
        collector_state(file_txid.clone(), 1, None, false)
            .save(&path)
            .unwrap();

        let state = super::load_collector_at(&path, &collector_settings(&"11".repeat(32), 4))
            .unwrap()
            .expect("state file");

        assert_eq!(state.outpoint.txid, file_txid);
        assert_eq!(state.outpoint.vout, 1);
        assert!(!state.closed);
    }

    fn collector_settings(txid: &str, vout: u32) -> crate::config::CollectorSettings {
        crate::config::CollectorSettings {
            withdraw_pubkey: String::new(),
            outpoint: Some(outpoint(txid, vout)),
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

    fn outpoint(txid: &str, vout: u32) -> OutPoint {
        OutPoint {
            txid: Txid::from_str(txid).unwrap(),
            vout,
        }
    }

    fn utxo_at(txid: &str, vout: u32) -> UTXO {
        UTXO {
            outpoint: outpoint(txid, vout),
            txout: TxOut::default(),
            secrets: None,
        }
    }
}
