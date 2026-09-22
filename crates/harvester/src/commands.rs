use crate::AppContext;
use crate::error::HarvesterError;
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
