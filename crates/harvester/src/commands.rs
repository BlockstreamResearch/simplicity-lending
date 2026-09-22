use crate::AppContext;
use crate::batch::{self, TxCost};
use crate::error::HarvesterError;
use crate::state::{self, State};
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
    tracing::info!(
        principal_asset = %ctx.settings.principal_asset,
        "bootstrap is not implemented"
    );
    Ok(())
}

pub async fn withdraw(ctx: &AppContext, to: Option<&str>) -> Result<(), HarvesterError> {
    let destination = to.map(str::to_owned).or_else(|| {
        let configured = ctx.settings.withdraw.destination_address.trim();
        (!configured.is_empty()).then(|| configured.to_owned())
    });

    tracing::info!(?destination, "withdraw is not implemented");
    Ok(())
}
