use std::collections::HashMap;
use std::collections::hash_map::Entry;
use std::path::Path;
use std::str::FromStr;

use lending_contracts::programs::asset_auth_vault::{AssetAuthVault, AssetAuthVaultParameters};
use lending_contracts::programs::fee_collector::{FeeCollector, FeeCollectorParameters};
use lending_contracts::programs::program::SimplexProgram;
use lending_indexer::api::ProtocolFeeVaultDto;
use serde::Deserialize;
use simplex::constants::MIN_FEE;
use simplex::provider::{EsploraProvider, ProviderError, ProviderTrait, SimplicityNetwork};
use simplex::signer::{Signer, SignerError};
use simplex::simplicityhl::elements::encode::{deserialize, serialize_hex};
use simplex::simplicityhl::elements::hex::ToHex;
use simplex::simplicityhl::elements::secp256k1_zkp::XOnlyPublicKey;
use simplex::simplicityhl::elements::{
    Address, AssetId, OutPoint, Script, Sequence, Transaction, Txid,
};
use simplex::transaction::{
    FinalTransaction, PartialInput, PartialOutput, RequiredSignature, UTXO,
};

use crate::AppContext;
use crate::batch::{self, FeeBatch, Selection, Step};
use crate::config::CollectorSettings;
use crate::error::HarvesterError;
use crate::state::{self, Outpoint, State};
use crate::vaults;

const BOOTSTRAP_AMOUNT: u64 = 1_000;

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
    let _lock = state::lock(&path)?;
    let collector = match load_collector(ctx)? {
        Some(state) => match settle_pending(ctx, &path, &state, CollectorOp::Harvest)? {
            PendingOutcome::Ready(state) => {
                tracing::info!(
                    path = %path.display(),
                    outpoint = %state.outpoint,
                    "loaded collector state"
                );
                state
            }
            PendingOutcome::Waiting => return Err(pending_in_mempool(&state)),
            PendingOutcome::Spent => return Err(HarvesterError::NotBootstrapped { path }),
        },
        None => return Err(HarvesterError::NotBootstrapped { path }),
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

pub async fn bootstrap(ctx: &AppContext) -> Result<(), HarvesterError> {
    let path = crate::state_path();
    let _lock = state::lock(&path)?;
    if load_collector(ctx)?.is_some() {
        return Err(HarvesterError::AlreadyBootstrapped);
    }

    let network = ctx.settings.esplora.simplicity_network();
    let principal_asset = parse_asset_id("principal_asset", &ctx.settings.principal_asset)?;
    let signer = harvest_signer(ctx)?;

    let funding_utxos = signer.get_utxos_asset(principal_asset)?;
    let total_amount = funding_utxos
        .iter()
        .try_fold(0u64, |acc, utxo| acc.checked_add(utxo.amount()))
        .ok_or(HarvesterError::AmountOverflow)?;

    if total_amount < BOOTSTRAP_AMOUNT {
        return Err(HarvesterError::NoBootstrapFunds {
            principal_asset: ctx.settings.principal_asset.clone(),
        });
    }

    let fee_collector = open_fee_collector(ctx)?;
    let (transaction, pool_amount) = finalize_bootstrap(
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
        &path,
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
                "bootstrapped the fee collector pool"
            );
        }
        PendingOutcome::Waiting => {
            tracing::info!(
                %txid,
                pool_amount,
                path = %path.display(),
                "bootstrapped the fee collector pool"
            );
        }
        PendingOutcome::Spent => {
            return Err(HarvesterError::CollectorOutputs { txid, count: 0 });
        }
    }

    Ok(())
}

fn prepare_harvest(
    ctx: &AppContext,
    path: &Path,
    state: &State,
    vaults: &[ProtocolFeeVaultDto],
    amounts: &[u64],
) -> Result<Option<(FeeBatch<Transaction>, State)>, HarvesterError> {
    let signer = harvest_signer(ctx)?;
    let collector = open_fee_collector(ctx)?;
    let (collector_utxo, state) = collector_utxo(path, &signer, &collector, state)?;
    let mut transaction = new_transaction();
    let mut keepers: HashMap<AssetId, Vec<UTXO>> = HashMap::new();
    let mut attached_keepers: HashMap<AssetId, (u32, u32)> = HashMap::new();
    let network = ctx.settings.esplora.simplicity_network();
    let principal_asset = parse_asset_id("principal_asset", &ctx.settings.principal_asset)?;
    let policy_asset = network.policy_asset();
    let min_fee = fee_floor(&state, policy_asset)?;
    let change_script = signer.get_address().script_pubkey();

    let selection = if principal_asset == policy_asset {
        Selection::Profitable
    } else {
        Selection::All
    };

    let batch = batch::select(
        amounts,
        ctx.settings.harvest.max_vaults_per_tx as usize,
        selection,
        |index, total_amount| {
            let vault = &vaults[index];
            let program = finalized_vault(vault, principal_asset, network)?;
            let keeper_asset = program.get_parameters().keeper_asset_id;
            let wallet_has_utxo = if attached_keepers.contains_key(&keeper_asset) {
                false
            } else {
                keeper_available(&signer, &mut keepers, keeper_asset)?
            };
            let keeper_choice = choose_keeper(&attached_keepers, wallet_has_utxo, keeper_asset);
            if keeper_choice == KeeperChoice::Missing {
                tracing::info!(
                    offer_id = %vault.offer_id,
                    asset = %vault.protocol_fee_keeper_asset,
                    "skipping vault: no keeper UTXO"
                );
                return Ok(Step::Skip);
            }

            if collector_utxo
                .explicit_amount()
                .checked_add(total_amount)
                .is_none()
            {
                return Err(HarvesterError::AmountOverflow);
            }

            let indexed_amount = amounts[index];
            let outpoint = format!("{}:{}", vault.txid, vault.vout);
            let vault_outpoint = parse_outpoint(&vault.txid, vault.vout)?;
            let Some(vault_utxo) = signer
                .get_provider()?
                .fetch_scripthash_utxos(&program.get_script_pubkey())?
                .into_iter()
                .find(|utxo| utxo.outpoint == vault_outpoint)
            else {
                tracing::warn!(
                    offer_id = %vault.offer_id,
                    %outpoint,
                    "skipping vault: protocol-fee UTXO was not found"
                );
                return Ok(Step::Skip);
            };

            let on_chain = vault_utxo.explicit_amount();
            if on_chain != indexed_amount {
                tracing::warn!(
                    offer_id = %vault.offer_id,
                    %outpoint,
                    on_chain,
                    indexed = indexed_amount,
                    "skipping vault: on-chain amount does not match the indexer"
                );
                return Ok(Step::Skip);
            }

            let (input_keeper_index, output_keeper_index) = match keeper_choice {
                KeeperChoice::Reuse {
                    input_index,
                    output_index,
                } => (input_index, output_index),
                KeeperChoice::Attach => {
                    let keeper_utxo = next_keeper(&signer, &mut keepers, keeper_asset)?
                        .expect("explicit keeper UTXO is cached");
                    let keeper_amount = keeper_utxo.explicit_amount();
                    let keeper_asset_id = keeper_utxo.explicit_asset();
                    let input_keeper_index = transaction.n_inputs() as u32;
                    let output_keeper_index = transaction.n_outputs() as u32;
                    transaction.add_input(
                        PartialInput::new(keeper_utxo),
                        RequiredSignature::NativeEcdsa,
                    );
                    transaction.add_output(PartialOutput::new(
                        change_script.clone(),
                        keeper_amount,
                        keeper_asset_id,
                    ));
                    attached_keepers
                        .insert(keeper_asset, (input_keeper_index, output_keeper_index));
                    (input_keeper_index, output_keeper_index)
                }
                KeeperChoice::Missing => unreachable!("missing keeper already skipped"),
            };
            program.attach_withdrawing_all(
                &mut transaction,
                vault_utxo,
                input_keeper_index,
                output_keeper_index,
            );

            let mut prefix = transaction.clone();
            collector.attach_deposit(&mut prefix, collector_utxo.clone(), total_amount);
            attach_fee_floor(&mut prefix, policy_asset, min_fee);
            match signer.finalize(&prefix) {
                Ok((transaction, _)) => {
                    let tx_fee = transaction.fee_in(policy_asset);
                    Ok(Step::Ready {
                        transaction,
                        tx_fee,
                    })
                }
                Err(SignerError::NotEnoughFunds(required_fee)) => {
                    Ok(Step::Stop(HarvesterError::InsufficientFeeFunds {
                        wallet: "harvest",
                        required_fee,
                    }))
                }
                Err(err) => Err(signer_error("harvest", err)),
            }
        },
    )?;
    Ok(batch.map(|batch| (batch, state)))
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

fn settle_pending(
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
            if replace_underpriced(state, &provider, op)? {
                tracing::info!(
                    txid = pending_txid,
                    "replacing underpriced collector transaction"
                );
                Ok(PendingOutcome::Ready(state.clone()))
            } else {
                tracing::info!(
                    txid = pending_txid,
                    "collector transaction is still in the mempool"
                );
                Ok(PendingOutcome::Waiting)
            }
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
            state::save(path, &confirmed)?;
            tracing::info!(
                outpoint = %confirmed.outpoint,
                path = %path.display(),
                "collector transaction confirmed"
            );
            Ok(PendingOutcome::Ready(confirmed))
        }
        [] if state.pending_script.is_some() => {
            let closed = clear_pending(state, true);
            state::save(path, &closed)?;
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

fn collector_utxo(
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
    state::save(path, &updated)?;
    tracing::info!(
        previous = %state.outpoint,
        outpoint = %updated.outpoint,
        "collector outpoint moved to the only unspent collector UTXO"
    );
    Ok(updated)
}

fn finalized_vault(
    vault: &ProtocolFeeVaultDto,
    principal_asset: AssetId,
    network: SimplicityNetwork,
) -> Result<AssetAuthVault, HarvesterError> {
    Ok(AssetAuthVault::new_finalized(AssetAuthVaultParameters {
        vault_asset_id: principal_asset,
        keeper_asset_id: parse_vault_asset(
            &vault.offer_id,
            "protocol_fee_keeper_asset",
            &vault.protocol_fee_keeper_asset,
        )?,
        supplier_asset_id: parse_vault_asset(
            &vault.offer_id,
            "borrower_nft_asset",
            &vault.borrower_nft_asset,
        )?,
        supply_goal: parse_vault_u64(&vault.offer_id, "supply_goal", &vault.supply_goal)?,
        with_keeper_asset_burn: false,
        with_supplier_asset_burn: false,
        network,
    }))
}

fn keeper_available(
    signer: &Signer,
    keepers: &mut HashMap<AssetId, Vec<UTXO>>,
    asset: AssetId,
) -> Result<bool, HarvesterError> {
    cache_explicit_keepers(signer, keepers, asset)?;
    Ok(keepers.get(&asset).is_some_and(|utxos| !utxos.is_empty()))
}

fn next_keeper(
    signer: &Signer,
    keepers: &mut HashMap<AssetId, Vec<UTXO>>,
    asset: AssetId,
) -> Result<Option<UTXO>, HarvesterError> {
    cache_explicit_keepers(signer, keepers, asset)?;
    Ok(keepers.get_mut(&asset).and_then(Vec::pop))
}

fn cache_explicit_keepers(
    signer: &Signer,
    keepers: &mut HashMap<AssetId, Vec<UTXO>>,
    asset: AssetId,
) -> Result<(), HarvesterError> {
    if let Entry::Vacant(entry) = keepers.entry(asset) {
        entry.insert(explicit_keeper_utxos(signer.get_utxos_asset(asset)?));
    }
    Ok(())
}

fn explicit_keeper_utxos(mut utxos: Vec<UTXO>) -> Vec<UTXO> {
    utxos.retain(|utxo| utxo.txout.asset.is_explicit() && utxo.txout.value.is_explicit());
    utxos
}

fn esplora_provider(ctx: &AppContext) -> EsploraProvider {
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

fn signer_error(wallet: &'static str, err: SignerError) -> HarvesterError {
    match err {
        SignerError::NotEnoughFunds(required_fee) => HarvesterError::InsufficientFeeFunds {
            wallet,
            required_fee,
        },
        err => err.into(),
    }
}

fn harvest_signer(ctx: &AppContext) -> Result<Signer, HarvesterError> {
    signer(ctx, &ctx.settings.harvest.mnemonic, "harvest.mnemonic")
}

fn withdraw_signer(ctx: &AppContext) -> Result<Signer, HarvesterError> {
    signer(ctx, &ctx.settings.withdraw.mnemonic, "withdraw.mnemonic")
}

fn open_fee_collector(ctx: &AppContext) -> Result<FeeCollector, HarvesterError> {
    Ok(FeeCollector::new(FeeCollectorParameters {
        withdrawal_pubkey: parse_withdrawal_pubkey(&ctx.settings.collector.withdraw_pubkey)?,
        network: ctx.settings.esplora.simplicity_network(),
    }))
}

fn parse_outpoint(txid: &str, vout: u32) -> Result<OutPoint, HarvesterError> {
    let txid = Txid::from_str(txid).map_err(|_| HarvesterError::InvalidTxid {
        txid: txid.to_owned(),
    })?;
    Ok(OutPoint { txid, vout })
}

fn parse_vault_asset(
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

fn parse_vault_u64(
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

fn parse_asset_id(field: &'static str, value: &str) -> Result<AssetId, HarvesterError> {
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

pub async fn withdraw(ctx: &AppContext, to: Option<&str>) -> Result<(), HarvesterError> {
    let destination = destination_script(ctx, to)?;
    let path = crate::state_path();
    let _lock = state::lock(&path)?;
    let state = match load_collector(ctx)? {
        None => return Err(HarvesterError::NotBootstrapped { path }),
        Some(state) => match settle_pending(ctx, &path, &state, CollectorOp::Withdraw)? {
            PendingOutcome::Ready(state) => state,
            PendingOutcome::Waiting => return Err(pending_in_mempool(&state)),
            PendingOutcome::Spent => return Ok(()),
        },
    };

    let signer = withdraw_signer(ctx)?;
    let collector = open_fee_collector(ctx)?;
    let (collector_utxo, state) = collector_utxo(&path, &signer, &collector, &state)?;
    let policy_asset = ctx.settings.esplora.simplicity_network().policy_asset();
    let (transaction, amount) = finalize_withdrawal(
        &signer,
        &collector,
        collector_utxo,
        destination,
        policy_asset,
        fee_floor(&state, policy_asset)?,
    )?;
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

fn finalize_withdrawal(
    signer: &Signer,
    collector: &FeeCollector,
    collector_utxo: UTXO,
    destination: Script,
    policy_asset: AssetId,
    min_fee: u64,
) -> Result<(Transaction, u64), HarvesterError> {
    let pool_amount = collector_utxo.explicit_amount();
    let asset = collector_utxo.explicit_asset();
    let mut transaction = new_transaction();
    collector.attach_withdrawal(&mut transaction, collector_utxo);
    transaction.add_output(PartialOutput::new(destination, pool_amount, asset));
    attach_fee_floor(&mut transaction, policy_asset, min_fee);
    let (transaction, _fee) = signer
        .finalize(&transaction)
        .map_err(|err| signer_error("withdraw", err))?;
    Ok((transaction, pool_amount))
}

fn finalize_bootstrap(
    signer: &Signer,
    fee_collector: &FeeCollector,
    principal_asset: AssetId,
    policy_asset: AssetId,
    principal_name: &str,
    funding_utxos: &[UTXO],
) -> Result<(Transaction, u64), HarvesterError> {
    let mut transaction = new_transaction();
    let mut change_output = None;
    let pool_amount = if principal_asset == policy_asset {
        BOOTSTRAP_AMOUNT
    } else {
        let selected = select_bootstrap_utxos(funding_utxos, principal_name)?;
        let total = selected
            .iter()
            .try_fold(0u64, |acc, utxo| acc.checked_add(utxo.amount()))
            .ok_or(HarvesterError::AmountOverflow)?;
        let confidential = selected.iter().any(is_confidential);
        let (pool_amount, change) = bootstrap_split(total, confidential);
        for utxo in selected {
            transaction.add_input(PartialInput::new(utxo), RequiredSignature::NativeEcdsa);
        }
        if change > 0 {
            let mut output = PartialOutput::new(
                signer.get_address().script_pubkey(),
                change,
                principal_asset,
            );
            if confidential {
                output = output.with_blinding_key(signer.get_blinding_public_key());
            }
            change_output = Some(output);
        }
        pool_amount
    };

    fee_collector.attach_creation(&mut transaction, principal_asset, pool_amount);
    if let Some(output) = change_output {
        transaction.add_output(output);
    }

    let (transaction, _fee) = signer
        .finalize(&transaction)
        .map_err(|err| signer_error("harvest", err))?;
    Ok((transaction, pool_amount))
}

fn select_bootstrap_utxos(
    funding_utxos: &[UTXO],
    principal_asset: &str,
) -> Result<Vec<UTXO>, HarvesterError> {
    let mut utxos = funding_utxos.to_vec();
    utxos.sort_by_key(UTXO::amount);

    if let Some(index) = utxos
        .iter()
        .position(|utxo| utxo.amount() >= BOOTSTRAP_AMOUNT)
    {
        return Ok(vec![utxos.swap_remove(index)]);
    }

    let mut selected = Vec::new();
    let mut total = 0u64;
    for utxo in utxos {
        total = total
            .checked_add(utxo.amount())
            .ok_or(HarvesterError::AmountOverflow)?;
        selected.push(utxo);
        if total >= BOOTSTRAP_AMOUNT {
            return Ok(selected);
        }
    }

    Err(HarvesterError::NoBootstrapFunds {
        principal_asset: principal_asset.to_owned(),
    })
}

fn bootstrap_split(total: u64, confidential: bool) -> (u64, u64) {
    let change = total.saturating_sub(BOOTSTRAP_AMOUNT);
    if change == 0 || confidential || change >= BOOTSTRAP_AMOUNT {
        (BOOTSTRAP_AMOUNT, change)
    } else {
        (total, 0)
    }
}

fn is_confidential(utxo: &UTXO) -> bool {
    !utxo.txout.asset.is_explicit() || !utxo.txout.value.is_explicit()
}

fn load_collector(ctx: &AppContext) -> Result<Option<State>, HarvesterError> {
    load_collector_at(&crate::state_path(), &ctx.settings.collector)
}

fn load_collector_at(
    path: &Path,
    collector: &CollectorSettings,
) -> Result<Option<State>, HarvesterError> {
    match state::load(path)? {
        Some(state) if state.closed => Ok(None),
        Some(state) => Ok(Some(state)),
        None => configured_collector(collector),
    }
}

fn configured_collector(collector: &CollectorSettings) -> Result<Option<State>, HarvesterError> {
    let Some(outpoint) = &collector.outpoint else {
        return Ok(None);
    };
    Txid::from_str(&outpoint.txid).map_err(|_| HarvesterError::InvalidSetting {
        field: "collector.outpoint.txid",
        value: outpoint.txid.clone(),
    })?;

    Ok(Some(State {
        outpoint: Outpoint {
            txid: outpoint.txid.clone(),
            vout: outpoint.vout,
        },
        pending_txid: None,
        pending_script: None,
        pending_tx: None,
        closed: false,
    }))
}

fn publish(
    ctx: &AppContext,
    path: &Path,
    outpoint: Outpoint,
    transaction: &Transaction,
    script_hex: &str,
) -> Result<PendingOutcome, HarvesterError> {
    let previous = state::load(path)?;
    let provider = esplora_provider(ctx);
    let txid = transaction.txid();
    let pending = State {
        outpoint,
        pending_txid: Some(txid.to_string()),
        pending_script: Some(script_hex.to_owned()),
        pending_tx: Some(serialize_hex(transaction)),
        closed: false,
    };
    state::save(path, &pending)?;

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
        state::save(path, previous)?;
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
        TxPresence::Absent if already_known(message) && in_flight(message) => {
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
            state::save(path, &closed)?;
            Ok(PendingOutcome::Spent)
        }
        PendingDrop::Keep(cleared) => {
            state::save(path, &cleared)?;
            Ok(PendingOutcome::Ready(cleared))
        }
    }
}

fn pending_drop(state: &State) -> PendingDrop {
    if unconfirmed_bootstrap(state) {
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

fn pending_in_mempool(state: &State) -> HarvesterError {
    HarvesterError::PendingInMempool {
        txid: state.pending_txid.clone().unwrap_or_default(),
    }
}

pub fn abandon(ctx: &AppContext) -> Result<(), HarvesterError> {
    let path = crate::state_path();
    let _lock = state::lock(&path)?;
    let (state, pending_txid) = load_pending(&path)?;
    let txid = Txid::from_str(&pending_txid).map_err(|_| HarvesterError::InvalidTxid {
        txid: pending_txid.clone(),
    })?;
    let provider = esplora_provider(ctx);
    match tx_presence(&provider, &txid)? {
        TxPresence::Confirmed => {
            apply_confirmation(ctx, &path, &state, &provider, &txid)?;
            Ok(())
        }
        TxPresence::Absent => {
            finish_drop(&path, &state)?;
            Ok(())
        }
        TxPresence::InMempool => {
            tracing::info!(
                txid = %pending_txid,
                "abandoning collector transaction that is still in the mempool"
            );
            finish_drop(&path, &state)?;
            Ok(())
        }
    }
}

fn load_pending(path: &Path) -> Result<(State, String), HarvesterError> {
    let state = state::load(path)?.ok_or_else(|| HarvesterError::NothingToAbandon {
        path: path.to_path_buf(),
    })?;
    let pending_txid =
        state
            .pending_txid
            .clone()
            .ok_or_else(|| HarvesterError::NothingToAbandon {
                path: path.to_path_buf(),
            })?;
    Ok((state, pending_txid))
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

fn already_known(message: &str) -> bool {
    let message = message.to_ascii_lowercase();
    message.contains("already in block")
        || message.contains("already-known")
        || message.contains("already-in-mempool")
        || message.contains("txn-already")
}

fn in_flight(message: &str) -> bool {
    let message = message.to_ascii_lowercase();
    message.contains("already in block") || message.contains("already-in-mempool")
}

fn choose_keeper(
    attached: &HashMap<AssetId, (u32, u32)>,
    wallet_has_utxo: bool,
    asset: AssetId,
) -> KeeperChoice {
    if let Some(&(input_index, output_index)) = attached.get(&asset) {
        KeeperChoice::Reuse {
            input_index,
            output_index,
        }
    } else if wallet_has_utxo {
        KeeperChoice::Attach
    } else {
        KeeperChoice::Missing
    }
}

fn new_transaction() -> FinalTransaction {
    let mut transaction = FinalTransaction::new();
    transaction.set_sequence(Sequence::ENABLE_RBF_NO_LOCKTIME);
    transaction
}

fn attach_fee_floor(transaction: &mut FinalTransaction, policy_asset: AssetId, floor: u64) {
    if floor > 0 {
        transaction.add_output(PartialOutput::new(Script::new(), floor, policy_asset));
    }
}

fn fee_floor(state: &State, policy_asset: AssetId) -> Result<u64, HarvesterError> {
    Ok(saved_transaction(state)?
        .map(|transaction| bumped_fee(transaction.fee_in(policy_asset)))
        .unwrap_or(0))
}

fn bumped_fee(previous: u64) -> u64 {
    if previous == 0 {
        0
    } else {
        previous.saturating_add(MIN_FEE.max(previous / 4))
    }
}

fn saved_transaction(state: &State) -> Result<Option<Transaction>, HarvesterError> {
    let Some(raw) = state.pending_tx.as_deref() else {
        return Ok(None);
    };
    let txid = state.pending_txid.as_deref().unwrap_or_default();
    decode_raw_transaction(raw, txid).map(Some)
}

fn pending_op(state: &State, transaction: &Transaction) -> Option<CollectorOp> {
    if unconfirmed_bootstrap(state) {
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

fn unconfirmed_bootstrap(state: &State) -> bool {
    state.pending_txid.as_deref() == Some(state.outpoint.txid.as_str())
}

fn replace_underpriced(
    state: &State,
    provider: &EsploraProvider,
    op: CollectorOp,
) -> Result<bool, HarvesterError> {
    let Some(transaction) = saved_transaction(state)? else {
        return Ok(false);
    };
    if pending_op(state, &transaction) != Some(op) || !signals_rbf(&transaction) {
        return Ok(false);
    }

    let paid = transaction.fee_in(provider.network.policy_asset());
    let market = market_fee(transaction.discount_weight(), provider.fetch_fee_rate(1)?);
    Ok(underpriced(paid, market))
}

fn signals_rbf(transaction: &Transaction) -> bool {
    let opt_in = Sequence::ENABLE_LOCKTIME_NO_RBF.to_consensus_u32();
    transaction
        .input
        .iter()
        .any(|input| input.sequence.to_consensus_u32() < opt_in)
}

fn underpriced(paid: u64, market: u64) -> bool {
    market > paid.saturating_add(MIN_FEE.max(paid / 4))
}

#[allow(
    clippy::cast_possible_truncation,
    clippy::cast_precision_loss,
    clippy::cast_sign_loss
)]
fn market_fee(weight: usize, fee_rate: f32) -> u64 {
    let vsize = weight.div_ceil(4).max(1) as f32;
    (vsize * fee_rate / 1000.0).ceil() as u64
}

enum PendingOutcome {
    Ready(State),
    Spent,
    Waiting,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CollectorOp {
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum KeeperChoice {
    Reuse { input_index: u32, output_index: u32 },
    Attach,
    Missing,
}

#[derive(Deserialize)]
struct TxStatus {
    confirmed: bool,
}

fn destination_script(ctx: &AppContext, to: Option<&str>) -> Result<Script, HarvesterError> {
    let address = to
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .or_else(|| {
            let configured = ctx.settings.withdraw.destination_address.trim();
            (!configured.is_empty()).then(|| configured.to_owned())
        })
        .ok_or(HarvesterError::MissingDestination)?;

    Address::from_str(&address)
        .map(|address| address.script_pubkey())
        .map_err(|_| HarvesterError::InvalidAddress { address })
}

#[cfg(test)]
mod tests {
    use std::str::FromStr;

    use simplex::signer::SignerError;
    use simplex::simplicityhl::elements::confidential::{
        self, AssetBlindingFactor, ValueBlindingFactor,
    };
    use simplex::simplicityhl::elements::encode::serialize_hex;
    use simplex::simplicityhl::elements::hex::ToHex;
    use simplex::simplicityhl::elements::secp256k1_zkp::Secp256k1;
    use simplex::simplicityhl::elements::{
        AssetId, LockTime, OutPoint, Script, Sequence, Transaction, TxIn, TxOut, TxOutSecrets, Txid,
    };
    use simplex::transaction::UTXO;

    use super::signer_error;
    use crate::error::HarvesterError;
    use crate::test_utils::TempDir;

    #[test]
    fn bootstrap_spends_the_smallest_utxo_that_covers_the_seed() {
        let asset = asset_id("11");
        let selected = super::select_bootstrap_utxos(
            &[
                explicit_keeper(asset, 500, 0),
                explicit_keeper(asset, super::BOOTSTRAP_AMOUNT, 1),
                explicit_keeper(asset, 50_000, 2),
            ],
            "11",
        )
        .unwrap();

        assert_eq!(selected.len(), 1);
        assert_eq!(selected[0].amount(), super::BOOTSTRAP_AMOUNT);
    }

    #[test]
    fn bootstrap_combines_utxos_until_the_seed_is_covered() {
        let asset = asset_id("11");
        let selected = super::select_bootstrap_utxos(
            &[
                explicit_keeper(asset, 400, 0),
                explicit_keeper(asset, 400, 1),
                explicit_keeper(asset, 400, 2),
            ],
            "11",
        )
        .unwrap();

        let total: u64 = selected.iter().map(UTXO::amount).sum();
        assert_eq!(selected.len(), 3);
        assert_eq!(total, 1_200);
    }

    #[test]
    fn bootstrap_rejects_a_wallet_below_the_seed() {
        let asset = asset_id("11");
        let error =
            super::select_bootstrap_utxos(&[explicit_keeper(asset, 400, 0)], "asset").unwrap_err();

        assert!(matches!(error, HarvesterError::NoBootstrapFunds { .. }));
    }

    #[test]
    fn explicit_change_below_the_seed_stays_in_the_collector() {
        assert_eq!(super::bootstrap_split(1_500, false), (1_500, 0));
        assert_eq!(
            super::bootstrap_split(5_000, false),
            (super::BOOTSTRAP_AMOUNT, 4_000)
        );
        assert_eq!(
            super::bootstrap_split(1_005, true),
            (super::BOOTSTRAP_AMOUNT, 5)
        );
    }

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
            outpoint: Some(crate::config::OutpointSettings {
                txid: txid.clone(),
                vout: 2,
            }),
        };

        let state = super::configured_collector(&collector)
            .unwrap()
            .expect("configured outpoint");

        assert_eq!(state.outpoint.txid, txid);
        assert_eq!(state.outpoint.vout, 2);
        assert_eq!(state.pending_txid, None);
    }

    #[test]
    fn configured_outpoint_rejects_an_invalid_txid() {
        let collector = crate::config::CollectorSettings {
            withdraw_pubkey: String::new(),
            outpoint: Some(crate::config::OutpointSettings {
                txid: "zz".to_owned(),
                vout: 0,
            }),
        };

        assert!(matches!(
            super::configured_collector(&collector),
            Err(HarvesterError::InvalidSetting {
                field: "collector.outpoint.txid",
                ..
            })
        ));
    }

    #[test]
    fn trailing_confidential_keeper_is_not_spent_before_an_explicit_one() {
        let asset = asset_id("11");
        let first = explicit_keeper(asset, 5, 1);
        let second = explicit_keeper(asset, 7, 2);
        let confidential = confidential_keeper(asset, 9, 3, false, false);
        assert_eq!(confidential.amount(), 9);
        assert_eq!(confidential.asset(), asset);

        let mut keepers = super::explicit_keeper_utxos(vec![first, second, confidential]);

        let chosen = keepers.pop().expect("explicit keeper");
        assert_eq!(chosen.explicit_amount(), 7);
        assert_eq!(chosen.explicit_asset(), asset);
        assert_eq!(
            keepers
                .pop()
                .expect("earlier explicit keeper")
                .explicit_amount(),
            5
        );
        assert!(keepers.pop().is_none());
    }

    #[test]
    fn keeper_input_must_be_explicit_in_both_asset_and_amount() {
        let asset = asset_id("11");
        let explicit = explicit_keeper(asset, 5, 1);
        let blinded_amount = confidential_keeper(asset, 9, 2, true, false);
        let blinded_asset = confidential_keeper(asset, 8, 3, false, true);

        let mut keepers =
            super::explicit_keeper_utxos(vec![explicit, blinded_amount, blinded_asset]);

        assert_eq!(keepers.len(), 1);
        let chosen = keepers.pop().expect("explicit keeper");
        assert_eq!(chosen.explicit_amount(), 5);
        assert_eq!(chosen.explicit_asset(), asset);
    }

    #[test]
    fn only_a_confidential_keeper_counts_as_missing() {
        let asset = asset_id("11");
        let confidential = confidential_keeper(asset, 9, 3, false, false);
        let available = !super::explicit_keeper_utxos(vec![confidential]).is_empty();

        assert!(!available);
        assert_eq!(
            super::choose_keeper(&std::collections::HashMap::new(), available, asset),
            super::KeeperChoice::Missing
        );
    }

    #[test]
    fn one_keeper_authorizes_every_later_vault() {
        let asset = asset_id("11");
        let other = asset_id("22");
        let mut attached = std::collections::HashMap::new();

        assert_eq!(
            super::choose_keeper(&attached, true, asset),
            super::KeeperChoice::Attach
        );
        attached.insert(asset, (0, 1));
        assert_eq!(
            super::choose_keeper(&attached, false, asset),
            super::KeeperChoice::Reuse {
                input_index: 0,
                output_index: 1,
            }
        );
        assert_eq!(
            super::choose_keeper(&attached, false, other),
            super::KeeperChoice::Missing
        );
        assert_eq!(
            super::choose_keeper(&attached, true, other),
            super::KeeperChoice::Attach
        );
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
        assert_eq!(crate::state::load(&path).unwrap().as_ref(), Some(&stored));

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
    fn already_known_broadcasts_are_not_rejections() {
        assert!(super::already_known("Transaction already in block chain"));
        assert!(super::already_known("txn-already-in-mempool"));
        assert!(super::already_known("txn-already-known"));
        assert!(!super::already_known("bad-txns-inputs-missingorspent"));
    }

    #[test]
    fn unindexed_reject_filter_is_not_left_in_flight() {
        assert!(super::in_flight("Transaction already in block chain"));
        assert!(super::in_flight("txn-already-in-mempool"));
        assert!(!super::in_flight("txn-already-known"));
        assert!(!super::in_flight("bad-txns-inputs-missingorspent"));
    }

    #[test]
    fn rejected_bootstrap_drops_the_unconfirmed_pool() {
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
    fn closed_state_file_ignores_the_configured_outpoint() {
        let dir = TempDir::new();
        let path = dir.path.join("state.json");
        let yaml_txid = "11".repeat(32);
        crate::state::save(&path, &collector_state("22".repeat(32), 0, None, true)).unwrap();

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
        crate::state::save(&path, &collector_state(file_txid.clone(), 1, None, false)).unwrap();

        let state = super::load_collector_at(&path, &collector_settings(&"11".repeat(32), 4))
            .unwrap()
            .expect("state file");

        assert_eq!(state.outpoint.txid, file_txid);
        assert_eq!(state.outpoint.vout, 1);
        assert!(!state.closed);
    }

    #[test]
    fn rejected_bootstrap_closes_state_instead_of_deleting_it() {
        let dir = TempDir::new();
        let path = dir.path.join("state.json");
        let txid = "aa".repeat(32);
        let state = collector_state(txid.clone(), 0, Some(txid.clone()), false);

        assert!(matches!(
            super::finish_drop(&path, &state).unwrap(),
            super::PendingOutcome::Spent
        ));

        let stored = crate::state::load(&path)
            .unwrap()
            .expect("closed state stays on disk");
        assert!(stored.closed);
        assert_eq!(stored.outpoint.txid, txid);
        assert_eq!(stored.pending_txid, None);
        assert_eq!(stored.pending_script, None);
        assert_eq!(stored.pending_tx, None);
        assert_eq!(
            super::load_collector_at(&path, &collector_settings(&"11".repeat(32), 3)).unwrap(),
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
        assert_eq!(crate::state::load(&path).unwrap().as_ref(), Some(&cleared));
    }

    #[test]
    fn replacement_fee_exceeds_the_previous_fee() {
        assert_eq!(super::bumped_fee(0), 0);
        assert_eq!(super::bumped_fee(16), 26);
        assert_eq!(super::bumped_fee(100), 125);
    }

    #[test]
    fn a_fee_inside_the_bump_band_is_left_in_the_mempool() {
        assert!(!super::underpriced(1_000, 1_250));
        assert!(super::underpriced(1_000, 1_251));
        assert!(!super::underpriced(0, 10));
        assert!(super::underpriced(0, 11));
    }

    #[test]
    fn market_fee_is_denominated_in_sats_per_thousand_vbytes() {
        assert_eq!(super::market_fee(4, 1_000.0), 1);
        assert_eq!(super::market_fee(8, 1_500.0), 3);
    }

    #[test]
    fn only_an_opted_in_transaction_can_be_replaced() {
        assert!(super::signals_rbf(&bare_transaction(
            Sequence::ENABLE_RBF_NO_LOCKTIME,
            Script::new(),
        )));
        assert!(!super::signals_rbf(&bare_transaction(
            Sequence::MAX,
            Script::new(),
        )));
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
        assert_eq!(
            super::fee_floor(&operation_state("51", false), asset_id("11")).unwrap(),
            0
        );
    }

    #[test]
    fn fee_floor_bumps_the_saved_transaction_fee() {
        let asset = asset_id("11");
        let transaction = Transaction {
            version: 2,
            lock_time: LockTime::ZERO,
            input: vec![TxIn {
                sequence: Sequence::ENABLE_RBF_NO_LOCKTIME,
                ..TxIn::default()
            }],
            output: vec![TxOut::new_fee(100, asset)],
        };
        let mut state = operation_state("51", false);
        state.pending_tx = Some(serialize_hex(&transaction));

        assert_eq!(super::fee_floor(&state, asset).unwrap(), 125);
    }

    #[test]
    fn abandon_requires_a_pending_transaction() {
        let dir = TempDir::new();
        let path = dir.path.join("state.json");
        assert!(matches!(
            super::load_pending(&path),
            Err(HarvesterError::NothingToAbandon { .. })
        ));

        let state = collector_state("aa".repeat(32), 1, None, false);
        crate::state::save(&path, &state).unwrap();

        assert!(matches!(
            super::load_pending(&path),
            Err(HarvesterError::NothingToAbandon { .. })
        ));
        assert_eq!(crate::state::load(&path).unwrap().as_ref(), Some(&state));
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

    fn operation_state(script: &str, bootstrap: bool) -> crate::state::State {
        let outpoint = "aa".repeat(32);
        let pending = if bootstrap {
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
            outpoint: Some(crate::config::OutpointSettings {
                txid: txid.to_owned(),
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

    fn asset_id(byte: &str) -> simplex::simplicityhl::elements::AssetId {
        simplex::simplicityhl::elements::AssetId::from_str(&byte.repeat(32)).unwrap()
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

    fn explicit_keeper(asset: AssetId, amount: u64, vout: u32) -> UTXO {
        UTXO {
            outpoint: outpoint(&"aa".repeat(32), vout),
            txout: TxOut::new_fee(amount, asset),
            secrets: None,
        }
    }

    fn confidential_keeper(
        asset: AssetId,
        amount: u64,
        vout: u32,
        explicit_asset: bool,
        explicit_value: bool,
    ) -> UTXO {
        let secp = Secp256k1::new();
        let asset_blinding = AssetBlindingFactor::from_slice(&[1; 32]).expect("asset blinding");
        let value_blinding = ValueBlindingFactor::from_slice(&[2; 32]).expect("value blinding");
        let blinded_asset = confidential::Asset::new_confidential(&secp, asset, asset_blinding);
        let blinded_value = confidential::Value::new_confidential_from_assetid(
            &secp,
            amount,
            asset,
            value_blinding,
            asset_blinding,
        );

        UTXO {
            outpoint: outpoint(&"bb".repeat(32), vout),
            txout: TxOut {
                asset: if explicit_asset {
                    confidential::Asset::Explicit(asset)
                } else {
                    blinded_asset
                },
                value: if explicit_value {
                    confidential::Value::Explicit(amount)
                } else {
                    blinded_value
                },
                ..TxOut::default()
            },
            secrets: Some(TxOutSecrets::new(
                asset,
                asset_blinding,
                amount,
                value_blinding,
            )),
        }
    }
}
