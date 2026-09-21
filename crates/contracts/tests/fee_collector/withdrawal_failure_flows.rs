use simplex::transaction::FinalTransaction;

use super::setup::{
    add_signer_output, assert_finalize_fails, get_collector_utxo,
    setup_fee_collector_with_withdrawal_pubkey,
};

#[simplex::test]
fn fails_to_withdraw_with_a_different_key(context: simplex::TestContext) -> anyhow::Result<()> {
    let signer = context.get_default_signer();
    let owner = context.random_signer();

    let initial_amount = 4_000;
    let (fee_collector, asset_id) = setup_fee_collector_with_withdrawal_pubkey(
        &context,
        initial_amount,
        vec![],
        owner.get_schnorr_public_key(),
    )?;

    let mut ft = FinalTransaction::new();
    fee_collector.attach_withdrawal(&mut ft, get_collector_utxo(&context, &fee_collector)?);
    add_signer_output(&mut ft, signer, initial_amount, asset_id);

    assert_finalize_fails(signer, &ft);

    Ok(())
}
