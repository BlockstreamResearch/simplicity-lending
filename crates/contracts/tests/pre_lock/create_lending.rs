use super::support::{create_lending_from_pre_lock_tx, setup_pre_lock};

#[simplex::test]
fn creates_lending_from_pre_lock(context: simplex::TestContext) -> anyhow::Result<()> {
    let provider = context.get_provider();

    let (txid, pre_lock) = setup_pre_lock(&context)?;
    provider.wait(&txid)?;

    let (txid, _) = create_lending_from_pre_lock_tx(&context, pre_lock, txid)?;
    provider.wait(&txid)?;

    Ok(())
}
