use super::common::asserts::assert_burn_output;
use super::common::issuance::issue_asset;
use super::common::wallet::split_first_signer_utxo;
use super::happy_path::{create_asset_auth_tx, unlock_asset_auth_tx};

#[simplex::test]
fn creates_and_unlocks_asset_auth_with_burn(context: simplex::TestContext) -> anyhow::Result<()> {
    let provider = context.get_provider();

    let txid = split_first_signer_utxo(&context, vec![1000]);
    provider.wait(&txid)?;

    let asset_amount = 1;
    let (txid, asset_id) = issue_asset(&context, asset_amount)?;
    provider.wait(&txid)?;

    let (txid, asset_auth) = create_asset_auth_tx(&context, asset_id, asset_amount, true)?;
    provider.wait(&txid)?;

    let txid = unlock_asset_auth_tx(&context, asset_auth)?;
    provider.wait(&txid)?;

    let tx = provider.fetch_transaction(&txid)?;
    let burn_output = tx.output[1].clone();
    assert_burn_output(&burn_output, asset_id, asset_amount);

    Ok(())
}
