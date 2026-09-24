use std::collections::HashMap;
use std::collections::hash_map::Entry;
use std::path::Path;
use std::str::FromStr;

use lending_contracts::programs::asset_auth_vault::{AssetAuthVault, AssetAuthVaultParameters};
use lending_contracts::programs::fee_collector::{FeeCollector, FeeCollectorParameters};
use lending_contracts::programs::program::SimplexProgram;
use lending_indexer::api::ProtocolFeeVaultDto;
use serde::Deserialize;
use simplex::provider::{EsploraProvider, ProviderError, ProviderTrait, SimplicityNetwork};
use simplex::signer::{Signer, SignerError};
use simplex::simplicityhl::elements::encode::{deserialize, serialize_hex};
use simplex::simplicityhl::elements::hex::ToHex;
use simplex::simplicityhl::elements::secp256k1_zkp::XOnlyPublicKey;
use simplex::simplicityhl::elements::{Address, AssetId, OutPoint, Script, Transaction, Txid};
use simplex::transaction::{
    FinalTransaction, PartialInput, PartialOutput, RequiredSignature, UTXO,
};

use crate::AppContext;
use crate::batch::{self, FeeBatch, Selection};
use crate::config::CollectorSettings;
use crate::error::HarvesterError;
use crate::state::{self, Outpoint, State};
use crate::vaults;

pub async fn run(ctx: &AppContext) -> Result<(), HarvesterError> {
    let interval = ctx.harvest_interval();
    tracing::info!(interval_secs = interval.as_secs(), "starting harvest loop");

    loop {
        if let Err(error) = harvest(ctx).await {
            tracing::error!(error = %error, "harvest failed");
        }
        tokio::time::sleep(interval).await;
    }
}

pub async fn harvest(ctx: &AppContext) -> Result<(), HarvesterError> {
    let path = crate::state_path();
    let collector = match load_collector(ctx)? {
        Some(state) => match settle_pending(ctx, &path, &state)? {
            PendingOutcome::Ready(state) => {
                tracing::info!(
                    path = %path.display(),
                    outpoint = %state.outpoint,
                    "loaded collector state"
                );
                Some(state)
            }
            PendingOutcome::Waiting | PendingOutcome::Spent => return Ok(()),
        },
        None => {
            tracing::info!(path = %path.display(), "collector state is absent");
            None
        }
    };

    let vaults = vaults::fetch_claimable_vaults(ctx).await?;

    tracing::info!(
        principal_asset = %ctx.settings.principal_asset,
        total_count = vaults.total_count,
        total_amount = %vaults.total_amount,
        fetched = vaults.items.len(),
        "fetched protocol-fee vaults"
    );

    for vault in &vaults.items {
        let outpoint = format!("{}:{}", vault.txid, vault.vout);
        tracing::info!(
            offer_id = %vault.offer_id,
            %outpoint,
            amount = %vault.amount,
            "protocol-fee vault"
        );
    }

    let amounts = vaults
        .items
        .iter()
        .map(vaults::parse_amount)
        .collect::<Result<Vec<_>, _>>()?;
    let Some(collector) = collector else {
        return Ok(());
    };
    let Some(batch) = prepare_harvest(ctx, &collector, &vaults.items, &amounts)? else {
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
    if load_collector(ctx)?.is_some() {
        return Err(HarvesterError::AlreadyBootstrapped);
    }

    let network = ctx.settings.esplora.simplicity_network()?;
    let principal_asset = parse_asset_id("principal_asset", &ctx.settings.principal_asset)?;
    let signer = harvest_signer(ctx)?;

    let funding_utxos = signer.get_utxos_asset(principal_asset)?;
    let total_amount = funding_utxos
        .iter()
        .try_fold(0u64, |acc, utxo| acc.checked_add(utxo.amount()))
        .ok_or(HarvesterError::AmountOverflow)?;

    if funding_utxos.is_empty() || total_amount == 0 {
        return Err(HarvesterError::NoBootstrapFunds {
            principal_asset: ctx.settings.principal_asset.clone(),
        });
    }

    let fee_collector = open_fee_collector(ctx)?;
    let (transaction, pool_amount) = finalize_bootstrap(
        &signer,
        &fee_collector,
        principal_asset,
        funding_utxos,
        total_amount,
        principal_asset == network.policy_asset(),
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
    state: &State,
    vaults: &[ProtocolFeeVaultDto],
    amounts: &[u64],
) -> Result<Option<FeeBatch<Transaction>>, HarvesterError> {
    let signer = harvest_signer(ctx)?;
    let collector = open_fee_collector(ctx)?;
    let collector_utxo = collector_utxo(&signer, &collector, state)?;
    let mut transaction = FinalTransaction::new();
    let mut keepers: HashMap<AssetId, Vec<UTXO>> = HashMap::new();
    let mut attached_keepers: HashMap<AssetId, (u32, u32)> = HashMap::new();
    let network = ctx.settings.esplora.simplicity_network()?;
    let principal_asset = parse_asset_id("principal_asset", &ctx.settings.principal_asset)?;
    let change_script = signer.get_address().script_pubkey();

    let selection = if principal_asset == network.policy_asset() {
        Selection::Profitable
    } else {
        Selection::All
    };

    batch::select(
        amounts,
        ctx.settings.harvest.max_vaults_per_tx as usize,
        selection,
        |index, total_amount| {
            let vault = &vaults[index];
            let program = finalized_vault(vault, principal_asset, network)?;
            let keeper_asset = program.get_parameters().keeper_asset_id;
            let has_utxo = if attached_keepers.contains_key(&keeper_asset) {
                false
            } else {
                keeper_available(&signer, &mut keepers, keeper_asset)?
            };
            if choose_keeper(&attached_keepers, has_utxo, keeper_asset) == KeeperChoice::Missing {
                tracing::info!(
                    offer_id = %vault.offer_id,
                    asset = %vault.protocol_fee_keeper_asset,
                    "skipping vault: no keeper UTXO"
                );
                return Ok(None);
            }

            if collector_utxo
                .explicit_amount()
                .checked_add(total_amount)
                .is_none()
            {
                return Err(HarvesterError::AmountOverflow);
            }

            let indexed_amount = vaults::parse_amount(vault)?;
            let outpoint = format!("{}:{}", vault.txid, vault.vout);
            let vault_outpoint = parse_outpoint(&vault.txid, vault.vout)?;
            let vault_utxo = signer
                .get_provider()?
                .fetch_scripthash_utxos(&program.get_script_pubkey())?
                .into_iter()
                .find(|utxo| utxo.outpoint == vault_outpoint)
                .ok_or_else(|| HarvesterError::MissingVaultUtxo {
                    offer_id: vault.offer_id.clone(),
                    outpoint: outpoint.clone(),
                })?;

            let on_chain = vault_utxo.explicit_amount();
            if on_chain != indexed_amount {
                return Err(HarvesterError::VaultAmountMismatch {
                    offer_id: vault.offer_id.clone(),
                    outpoint,
                    on_chain,
                    indexed: indexed_amount,
                });
            }

            let (input_keeper_index, output_keeper_index) =
                if let Some(&(input_index, output_index)) = attached_keepers.get(&keeper_asset) {
                    (input_index, output_index)
                } else {
                    let Some(keeper_utxo) = next_keeper(&signer, &mut keepers, keeper_asset)?
                    else {
                        tracing::info!(
                            offer_id = %vault.offer_id,
                            asset = %vault.protocol_fee_keeper_asset,
                            "skipping vault: no keeper UTXO"
                        );
                        return Ok(None);
                    };
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
                };
            program.attach_withdrawing_all(
                &mut transaction,
                vault_utxo,
                input_keeper_index,
                output_keeper_index,
            );

            let mut prefix = transaction.clone();
            collector.attach_deposit(&mut prefix, collector_utxo.clone(), total_amount);
            let finalized = signer
                .finalize(&prefix)
                .map_err(|err| signer_error("harvest", err))?;

            Ok(Some(finalized))
        },
    )
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
) -> Result<PendingOutcome, HarvesterError> {
    let Some(pending_txid) = state.pending_txid.as_deref() else {
        return Ok(PendingOutcome::Ready(state.clone()));
    };
    let txid = Txid::from_str(pending_txid).map_err(|_| HarvesterError::InvalidTxid {
        txid: pending_txid.to_owned(),
    })?;
    let provider = esplora_provider(ctx)?;
    match tx_presence(&provider, &txid)? {
        TxPresence::InMempool => {
            tracing::info!(
                txid = pending_txid,
                "collector transaction is still in the mempool"
            );
            Ok(PendingOutcome::Waiting)
        }
        TxPresence::Confirmed => apply_confirmation(ctx, path, state, &provider, &txid),
        TxPresence::Absent => rebroadcast_pending(ctx, path, state, &provider, &txid),
    }
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
            state::remove(path)?;
            tracing::info!(
                txid = %pending_txid,
                path = %path.display(),
                "confirmed transaction spent the collector; removed state"
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
    signer: &Signer,
    collector: &FeeCollector,
    state: &State,
) -> Result<UTXO, HarvesterError> {
    let outpoint = parse_outpoint(&state.outpoint.txid, state.outpoint.vout)?;
    signer
        .get_provider()?
        .fetch_scripthash_utxos(&collector.get_script_pubkey())?
        .into_iter()
        .find(|utxo| utxo.outpoint == outpoint)
        .ok_or_else(|| HarvesterError::MissingCollectorUtxo {
            outpoint: state.outpoint.to_string(),
        })
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
    if let Entry::Vacant(entry) = keepers.entry(asset) {
        entry.insert(signer.get_utxos_asset(asset)?);
    }

    Ok(keepers.get(&asset).is_some_and(|utxos| !utxos.is_empty()))
}

fn next_keeper(
    signer: &Signer,
    keepers: &mut HashMap<AssetId, Vec<UTXO>>,
    asset: AssetId,
) -> Result<Option<UTXO>, HarvesterError> {
    if let Entry::Vacant(entry) = keepers.entry(asset) {
        entry.insert(signer.get_utxos_asset(asset)?);
    }

    Ok(keepers.get_mut(&asset).and_then(Vec::pop))
}

fn esplora_provider(ctx: &AppContext) -> Result<EsploraProvider, HarvesterError> {
    Ok(EsploraProvider::new(
        ctx.settings.esplora.base_url.clone(),
        ctx.settings.esplora.simplicity_network()?,
    ))
}

fn signer(ctx: &AppContext, mnemonic: &str, field: &'static str) -> Result<Signer, HarvesterError> {
    let mnemonic = validate_mnemonic(field, mnemonic)?;
    Ok(Signer::new(&mnemonic, Box::new(esplora_provider(ctx)?)))
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
        network: ctx.settings.esplora.simplicity_network()?,
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
    let state = match load_collector(ctx)? {
        None => return Err(HarvesterError::NotBootstrapped { path }),
        Some(state) => match settle_pending(ctx, &path, &state)? {
            PendingOutcome::Ready(state) => state,
            PendingOutcome::Waiting | PendingOutcome::Spent => return Ok(()),
        },
    };

    let signer = withdraw_signer(ctx)?;
    let collector = open_fee_collector(ctx)?;
    let collector_utxo = collector_utxo(&signer, &collector, &state)?;
    let amount = collector_utxo.explicit_amount();
    let asset = collector_utxo.explicit_asset();

    let mut transaction = FinalTransaction::new();
    collector.attach_withdrawal(&mut transaction, collector_utxo);
    transaction.add_output(PartialOutput::new(destination, amount, asset));

    let (transaction, _fee) = signer
        .finalize(&transaction)
        .map_err(|err| signer_error("withdraw", err))?;
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

fn finalize_bootstrap(
    signer: &Signer,
    fee_collector: &FeeCollector,
    principal_asset: AssetId,
    funding_utxos: Vec<UTXO>,
    total_amount: u64,
    pays_fee_from_principal: bool,
) -> Result<(Transaction, u64), HarvesterError> {
    if !pays_fee_from_principal {
        let mut transaction = FinalTransaction::new();
        for utxo in funding_utxos {
            transaction.add_input(PartialInput::new(utxo), RequiredSignature::NativeEcdsa);
        }
        fee_collector.attach_creation(&mut transaction, principal_asset, total_amount);
        let (transaction, _fee) = signer
            .finalize(&transaction)
            .map_err(|err| signer_error("harvest", err))?;
        return Ok((transaction, total_amount));
    }

    let mut reserved = 0u64;
    loop {
        if total_amount <= reserved {
            return Err(HarvesterError::InsufficientFeeFunds {
                wallet: "harvest",
                required_fee: reserved,
            });
        }
        let pool_amount = total_amount - reserved;

        let mut transaction = FinalTransaction::new();
        for utxo in &funding_utxos {
            transaction.add_input(
                PartialInput::new(utxo.clone()),
                RequiredSignature::NativeEcdsa,
            );
        }
        fee_collector.attach_creation(&mut transaction, principal_asset, pool_amount);

        match signer.finalize(&transaction) {
            Ok((transaction, _fee)) => return Ok((transaction, pool_amount)),
            Err(SignerError::NotEnoughFunds(required)) if required > reserved => {
                reserved = required;
            }
            Err(err) => return Err(signer_error("harvest", err)),
        }
    }
}

fn load_collector(ctx: &AppContext) -> Result<Option<State>, HarvesterError> {
    if let Some(state) = state::load(&crate::state_path())? {
        return Ok(Some(state));
    }
    configured_collector(&ctx.settings.collector)
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
    }))
}

fn publish(
    ctx: &AppContext,
    path: &Path,
    outpoint: Outpoint,
    transaction: &Transaction,
    script_hex: &str,
) -> Result<PendingOutcome, HarvesterError> {
    let provider = esplora_provider(ctx)?;
    let txid = transaction.txid();
    let pending = State {
        outpoint,
        pending_txid: Some(txid.to_string()),
        pending_script: Some(script_hex.to_owned()),
        pending_tx: Some(serialize_hex(transaction)),
    };
    state::save(path, &pending)?;

    match provider.broadcast_transaction(transaction) {
        Ok(_) => {
            tracing::info!(txid = %txid, "broadcast collector transaction");
        }
        Err(ProviderError::BroadcastRejected { message, .. }) if already_known(&message) => {
            tracing::info!(txid = %txid, "collector transaction is already known");
        }
        Err(err @ ProviderError::BroadcastRejected { .. }) => {
            tracing::warn!(txid = %txid, error = %err, "collector broadcast was rejected");
            finish_drop(path, &pending)?;
            return Err(err.into());
        }
        Err(err) => return Err(err.into()),
    }

    settle_pending(ctx, path, &pending)
}

fn rebroadcast_pending(
    ctx: &AppContext,
    path: &Path,
    state: &State,
    provider: &EsploraProvider,
    txid: &Txid,
) -> Result<PendingOutcome, HarvesterError> {
    let pending_txid = txid.to_string();
    let Some(raw) = state.pending_tx.as_deref() else {
        tracing::warn!(
            txid = %pending_txid,
            "pending collector transaction is absent and has no saved payload"
        );
        return finish_drop(path, state);
    };

    let transaction = decode_raw_transaction(raw, &pending_txid)?;
    match provider.broadcast_transaction(&transaction) {
        Ok(_) => {
            tracing::info!(txid = %pending_txid, "rebroadcast pending collector transaction");
            Ok(PendingOutcome::Waiting)
        }
        Err(ProviderError::BroadcastRejected { message, .. }) if already_known(&message) => {
            follow_known(ctx, path, state, provider, txid)
        }
        Err(ProviderError::BroadcastRejected { message, .. }) => match tx_presence(provider, txid)?
        {
            TxPresence::Confirmed => apply_confirmation(ctx, path, state, provider, txid),
            TxPresence::InMempool => {
                tracing::info!(
                    txid = %pending_txid,
                    "collector transaction is still in the mempool"
                );
                Ok(PendingOutcome::Waiting)
            }
            TxPresence::Absent => {
                tracing::warn!(
                    txid = %pending_txid,
                    reason = %message,
                    "pending collector transaction was dropped"
                );
                finish_drop(path, state)
            }
        },
        Err(err) => Err(err.into()),
    }
}

fn follow_known(
    ctx: &AppContext,
    path: &Path,
    state: &State,
    provider: &EsploraProvider,
    txid: &Txid,
) -> Result<PendingOutcome, HarvesterError> {
    match tx_presence(provider, txid)? {
        TxPresence::Confirmed => apply_confirmation(ctx, path, state, provider, txid),
        TxPresence::InMempool => {
            tracing::info!(
                txid = %txid,
                "collector transaction is still in the mempool"
            );
            Ok(PendingOutcome::Waiting)
        }
        TxPresence::Absent => {
            tracing::info!(txid = %txid, "collector transaction is already known");
            Ok(PendingOutcome::Waiting)
        }
    }
}

fn finish_drop(path: &Path, state: &State) -> Result<PendingOutcome, HarvesterError> {
    match pending_drop(state) {
        PendingDrop::Remove => {
            state::remove(path)?;
            Ok(PendingOutcome::Spent)
        }
        PendingDrop::Keep(cleared) => {
            state::save(path, &cleared)?;
            Ok(PendingOutcome::Ready(cleared))
        }
    }
}

fn pending_drop(state: &State) -> PendingDrop {
    let unconfirmed_bootstrap = state.pending_txid.as_deref() == Some(state.outpoint.txid.as_str());
    if unconfirmed_bootstrap {
        PendingDrop::Remove
    } else {
        PendingDrop::Keep(State {
            outpoint: state.outpoint.clone(),
            pending_txid: None,
            pending_script: None,
            pending_tx: None,
        })
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

fn already_known(message: &str) -> bool {
    let message = message.to_ascii_lowercase();
    message.contains("already in block")
        || message.contains("already-known")
        || message.contains("already-in-mempool")
        || message.contains("txn-already")
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

enum PendingOutcome {
    Ready(State),
    Spent,
    Waiting,
}

enum PendingDrop {
    Remove,
    Keep(State),
}

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

    use super::signer_error;
    use crate::error::HarvesterError;

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
    fn already_known_broadcasts_are_not_rejections() {
        assert!(super::already_known("Transaction already in block chain"));
        assert!(super::already_known("txn-already-in-mempool"));
        assert!(super::already_known("txn-already-known"));
        assert!(!super::already_known("bad-txns-inputs-missingorspent"));
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
        };

        let super::PendingDrop::Keep(cleared) = super::pending_drop(&state) else {
            panic!("harvest outpoint must stay");
        };
        assert_eq!(cleared.outpoint.vout, 1);
        assert_eq!(cleared.pending_txid, None);
        assert_eq!(cleared.pending_script, None);
        assert_eq!(cleared.pending_tx, None);
    }

    fn asset_id(byte: &str) -> simplex::simplicityhl::elements::AssetId {
        simplex::simplicityhl::elements::AssetId::from_str(&byte.repeat(32)).unwrap()
    }
}
