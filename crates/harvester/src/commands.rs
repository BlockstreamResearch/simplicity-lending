use std::collections::HashMap;
use std::collections::hash_map::Entry;
use std::path::Path;
use std::str::FromStr;

use lending_contracts::programs::asset_auth_vault::{AssetAuthVault, AssetAuthVaultParameters};
use lending_contracts::programs::fee_collector::{FeeCollector, FeeCollectorParameters};
use lending_contracts::programs::program::SimplexProgram;
use lending_indexer::api::ProtocolFeeVaultDto;
use simplex::provider::{EsploraProvider, ProviderTrait, SimplicityNetwork};
use simplex::signer::{Signer, SignerError};
use simplex::simplicityhl::elements::secp256k1_zkp::XOnlyPublicKey;
use simplex::simplicityhl::elements::{Address, AssetId, OutPoint, Script, Transaction, Txid};
use simplex::transaction::{
    FinalTransaction, PartialInput, PartialOutput, RequiredSignature, UTXO,
};

use crate::AppContext;
use crate::batch::{self, FeeBatch};
use crate::error::HarvesterError;
use crate::state::{self, Outpoint, State};
use crate::vaults;

pub async fn run(ctx: &AppContext) -> Result<(), HarvesterError> {
    let interval = ctx.harvest_interval();
    tracing::info!(interval_secs = interval.as_secs(), "starting harvest loop");

    loop {
        harvest(ctx).await?;
        tokio::time::sleep(interval).await;
    }
}

pub async fn harvest(ctx: &AppContext) -> Result<(), HarvesterError> {
    let path = crate::state_path();
    let collector = match state::load(&path)? {
        Some(State {
            outpoint,
            pending_txid: Some(pending_txid),
        }) => {
            tracing::info!(
                path = %path.display(),
                %outpoint,
                %pending_txid,
                "waiting for the pending collector transaction"
            );
            settle_pending(ctx, &path, &pending_txid)?
        }
        Some(state) => {
            tracing::info!(
                path = %path.display(),
                outpoint = %state.outpoint,
                "loaded collector state"
            );
            Some(state)
        }
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
        tracing::info!("no profitable protocol-fee batch");
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
    if state::load(&path)?.is_some() {
        return Err(HarvesterError::AlreadyBootstrapped { path });
    }

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

    let mut ft = FinalTransaction::new();
    for utxo in funding_utxos {
        ft.add_input(PartialInput::new(utxo), RequiredSignature::NativeEcdsa);
    }
    fee_collector.attach_creation(&mut ft, principal_asset, total_amount);

    let receipt = signer
        .broadcast(&ft)
        .map_err(|err| signer_error("harvest", err))?;
    let txid = receipt.txid().to_string();

    state::save(
        &path,
        &State {
            outpoint: Outpoint {
                txid: txid.clone(),
                vout: 0,
            },
            pending_txid: Some(txid.clone()),
        },
    )?;

    tracing::info!(
        %txid,
        total_amount,
        path = %path.display(),
        "bootstrapped the fee collector pool"
    );

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
    let network = ctx.settings.esplora.simplicity_network()?;
    let principal_asset = parse_asset_id("principal_asset", &ctx.settings.principal_asset)?;
    let change_script = signer.get_address().script_pubkey();

    batch::select_profitable(
        amounts,
        ctx.settings.harvest.max_vaults_per_tx as usize,
        |index, total_amount| {
            let vault = &vaults[index];
            let program = finalized_vault(vault, principal_asset, network)?;
            let Some(keeper_utxo) = next_keeper(
                &signer,
                &mut keepers,
                program.get_parameters().keeper_asset_id,
            )?
            else {
                tracing::info!(
                    offer_id = %vault.offer_id,
                    asset = %vault.protocol_fee_keeper_asset,
                    "skipping vault: no unused keeper UTXO"
                );
                return Ok(None);
            };

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
    let signer = harvest_signer(ctx)?;
    let receipt = signer.get_provider()?.broadcast_transaction(&transaction)?;
    let txid = receipt.txid().to_string();

    state::save(
        path,
        &State {
            outpoint: state.outpoint.clone(),
            pending_txid: Some(txid.clone()),
        },
    )?;

    tracing::info!(%txid, total_amount, "broadcast harvest transaction");

    let Some(confirmed) = settle_pending(ctx, path, &txid)? else {
        return Err(HarvesterError::CollectorOutputs { txid, count: 0 });
    };
    tracing::info!(
        outpoint = %confirmed.outpoint,
        path = %path.display(),
        "harvest transaction confirmed"
    );

    Ok(())
}

fn settle_pending(
    ctx: &AppContext,
    path: &Path,
    pending_txid: &str,
) -> Result<Option<State>, HarvesterError> {
    let collector = open_fee_collector(ctx)?;
    let txid = Txid::from_str(pending_txid).map_err(|_| HarvesterError::InvalidTxid {
        txid: pending_txid.to_owned(),
    })?;
    let provider = esplora_provider(ctx)?;
    provider.wait(&txid)?;

    let script = collector.get_script_pubkey();
    let outputs = provider.fetch_transaction(&txid)?;
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
                    txid: pending_txid.to_owned(),
                    vout: *vout,
                },
                pending_txid: None,
            };
            state::save(path, &confirmed)?;
            Ok(Some(confirmed))
        }
        [] => {
            state::remove(path)?;
            tracing::info!(
                txid = pending_txid,
                path = %path.display(),
                "confirmed transaction spent the collector; removed state"
            );
            Ok(None)
        }
        _ => Err(HarvesterError::CollectorOutputs {
            txid: pending_txid.to_owned(),
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

fn signer(ctx: &AppContext, mnemonic: &str) -> Result<Signer, HarvesterError> {
    Ok(Signer::new(mnemonic, Box::new(esplora_provider(ctx)?)))
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
    signer(ctx, &ctx.settings.harvest.mnemonic)
}

fn withdraw_signer(ctx: &AppContext) -> Result<Signer, HarvesterError> {
    signer(ctx, &ctx.settings.withdraw.mnemonic)
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
    let state = match state::load(&path)? {
        None => return Err(HarvesterError::NotBootstrapped { path }),
        Some(State {
            outpoint,
            pending_txid: Some(pending_txid),
        }) => {
            tracing::info!(
                path = %path.display(),
                %outpoint,
                %pending_txid,
                "waiting for the pending collector transaction"
            );
            match settle_pending(ctx, &path, &pending_txid)? {
                Some(state) => state,
                None => return Ok(()),
            }
        }
        Some(state) => state,
    };

    let signer = withdraw_signer(ctx)?;
    let collector = open_fee_collector(ctx)?;
    let collector_utxo = collector_utxo(&signer, &collector, &state)?;
    let amount = collector_utxo.explicit_amount();
    let asset = collector_utxo.explicit_asset();

    let mut transaction = FinalTransaction::new();
    collector.attach_withdrawal(&mut transaction, collector_utxo);
    transaction.add_output(PartialOutput::new(destination, amount, asset));

    let receipt = signer
        .broadcast(&transaction)
        .map_err(|err| signer_error("withdraw", err))?;
    let txid = receipt.txid().to_string();
    state::save(
        &path,
        &State {
            outpoint: state.outpoint,
            pending_txid: Some(txid.clone()),
        },
    )?;
    tracing::info!(%txid, amount, "broadcast withdrawal");

    if settle_pending(ctx, &path, &txid)?.is_some() {
        return Err(HarvesterError::CollectorOutputs { txid, count: 1 });
    }

    Ok(())
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
}
