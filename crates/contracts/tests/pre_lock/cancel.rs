use super::support::{cancel_pre_lock_tx, setup_pre_lock};

#[simplex::test]
fn cancels_pre_lock(context: simplex::TestContext) -> anyhow::Result<()> {
    let provider = context.get_default_provider();

    let (txid, pre_lock) = setup_pre_lock(&context)?;
    provider.wait(&txid)?;

    let txid = cancel_pre_lock_tx(&context, pre_lock, txid)?;
    provider.wait(&txid)?;

    Ok(())
}
