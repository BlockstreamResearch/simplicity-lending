use crate::AppContext;
use crate::error::HarvesterError;

pub async fn run(ctx: &AppContext) -> Result<(), HarvesterError> {
    let interval = ctx.harvest_interval();
    tracing::info!(
        interval_secs = interval.as_secs(),
        "starting harvest loop (not implemented)"
    );

    loop {
        harvest(ctx).await?;
        tokio::time::sleep(interval).await;
    }
}

pub async fn harvest(ctx: &AppContext) -> Result<(), HarvesterError> {
    tracing::info!(
        indexer = %ctx.settings.indexer.base_url,
        principal_asset = %ctx.settings.principal_asset,
        "harvest is not implemented"
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
