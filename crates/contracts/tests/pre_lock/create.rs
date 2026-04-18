use crate::common::flows::pre_lock_flow::setup_pre_lock;

#[simplex::test]
fn creates_pre_lock(context: simplex::TestContext) -> anyhow::Result<()> {
    let provider = context.get_default_provider();

    let (txid, _) = setup_pre_lock(&context)?;
    provider.wait(&txid)?;

    Ok(())
}
