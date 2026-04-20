use anyhow::Result;
use simplex::{
    simplicityhl::elements::Script,
    wallet_abi::{ElementsSequence, InputUnblinding, LockVariant, WalletAbiHarness},
};

use crate::{
    common::{
        asserts::assert_burn_output, flows::pre_lock_flow::setup_lending_fixture,
        process_req::process_wallet_abi_request, tx_steps::wait_for_tx, utxo::fetch_output_utxo,
    },
    lending::support::repay_lending_tx,
    wallet_abi::support::{asset_auth_finalizer, policy_fee_source},
};

#[simplex::test]
fn wallet_abi_claims_lender_principal(context: simplex::TestContext) -> Result<()> {
    let fixture = setup_lending_fixture(&context)?;
    wait_for_tx(&context, &fixture.lending_txid)?;

    let lending_parameters = *fixture.lending.get_lending_parameters();
    let repayment_txid = repay_lending_tx(&context, fixture.lending, fixture.lending_txid)?;
    wait_for_tx(&context, &repayment_txid)?;

    let lender_principal_asset_auth = lending_parameters.get_lender_principal_asset_auth();
    let principal_with_interest = lending_parameters
        .offer_parameters
        .calculate_principal_with_interest();
    let lender_principal_utxo = fetch_output_utxo(&context, repayment_txid, 1)?;

    let harness = WalletAbiHarness::from_test_context(context)?;
    let processed = process_wallet_abi_request(
        &harness,
        harness
            .tx()
            .provided_input(
                "locked-lender-principal",
                &lender_principal_utxo,
                InputUnblinding::Explicit,
                asset_auth_finalizer(&harness, &lender_principal_asset_auth)?,
            )
            .wallet_input_exact("lender-nft", lending_parameters.lender_nft_asset_id, 1)
            .raw_wallet_input(
                "fee-input",
                policy_fee_source(&harness),
                ElementsSequence::ENABLE_LOCKTIME_NO_RBF,
            )
            .explicit_output(
                "claimed-principal",
                harness.signer_script(),
                lending_parameters.principal_asset_id,
                principal_with_interest,
            )
            .raw_output(
                "burned-lender-nft",
                LockVariant::Script {
                    script: Script::new_op_return(b"burn"),
                },
                lending_parameters.lender_nft_asset_id,
                1,
            )
            .build_create()?,
    )?;

    let claimed_principal = processed.output("claimed-principal")?;
    let burned_lender_nft = processed.output("burned-lender-nft")?;

    assert!(
        processed
            .tx
            .input
            .iter()
            .any(|input| input.previous_output == lender_principal_utxo.outpoint)
    );
    assert_eq!(claimed_principal.outpoint.vout, 0);
    assert_eq!(
        claimed_principal.txout.script_pubkey,
        harness.signer_script()
    );
    assert_eq!(
        claimed_principal.asset_id(),
        lending_parameters.principal_asset_id
    );
    assert_eq!(claimed_principal.amount(), principal_with_interest);
    assert_burn_output(
        &burned_lender_nft.txout,
        lending_parameters.lender_nft_asset_id,
        1,
    );

    Ok(())
}
