use std::str::FromStr;

use lending_contracts::programs::fee_collector::{FeeCollector, FeeCollectorParameters};
use simplex::provider::EsploraProvider;
use simplex::signer::Signer;
use simplex::simplicityhl::elements::AssetId;
use simplex::simplicityhl::elements::secp256k1_zkp::XOnlyPublicKey;
use simplex::transaction::{FinalTransaction, PartialInput, RequiredSignature};

use crate::AppContext;
use crate::batch::{self, TxCost};
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
    match state::load(&path)? {
        Some(State {
            outpoint,
            pending_txid: Some(pending_txid),
        }) => {
            tracing::info!(
                path = %path.display(),
                %outpoint,
                %pending_txid,
                "skipping harvest while a collector transaction is pending"
            );
            return Ok(());
        }
        Some(State {
            outpoint,
            pending_txid: None,
        }) => {
            tracing::info!(path = %path.display(), %outpoint, "loaded collector state");
        }
        None => {
            tracing::info!(path = %path.display(), "collector state is absent");
        }
    }

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
    let batch = batch::select_profitable(
        &amounts,
        TxCost::harvest(ctx.settings.harvest.fee_rate),
        ctx.settings.harvest.max_vaults_per_tx as usize,
    );

    tracing::info!(
        selected = batch.count,
        total_amount = batch.total_amount,
        tx_fee = batch.tx_fee,
        "selected protocol-fee batch"
    );

    Ok(())
}

pub async fn bootstrap(ctx: &AppContext) -> Result<(), HarvesterError> {
    let path = crate::state_path();
    if state::load(&path)?.is_some() {
        return Err(HarvesterError::AlreadyBootstrapped { path });
    }

    let principal_asset = parse_asset_id("principal_asset", &ctx.settings.principal_asset)?;
    let withdrawal_pubkey = parse_withdrawal_pubkey(&ctx.settings.collector.withdraw_pubkey)?;
    let network = ctx.settings.esplora.simplicity_network()?;

    let signer = Signer::new(
        &ctx.settings.harvest.mnemonic,
        Box::new(EsploraProvider::new(
            ctx.settings.esplora.base_url.clone(),
            network,
        )),
    );

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

    let fee_collector = FeeCollector::new(FeeCollectorParameters {
        withdrawal_pubkey,
        network,
    });

    let mut ft = FinalTransaction::new();
    for utxo in funding_utxos {
        ft.add_input(PartialInput::new(utxo), RequiredSignature::NativeEcdsa);
    }
    fee_collector.attach_creation(&mut ft, principal_asset, total_amount);

    let receipt = signer.broadcast(&ft)?;
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
    let destination = to.map(str::to_owned).or_else(|| {
        let configured = ctx.settings.withdraw.destination_address.trim();
        (!configured.is_empty()).then(|| configured.to_owned())
    });

    tracing::info!(?destination, "withdraw is not implemented");
    Ok(())
}
