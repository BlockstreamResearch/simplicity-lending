use anyhow::Result;
use lending_contracts::programs::{AssetAuth, AssetAuthParameters, program::SimplexProgram};
use simplex::{
    simplicityhl::elements::Script,
    wallet_abi::{ElementsSequence, InputUnblinding, LockVariant, WalletAbiHarness},
};

use crate::{
    common::{
        asserts::assert_burn_output, issuance::issue_asset,
        process_req::process_wallet_abi_request, tx_steps::wait_for_tx,
        wallet::split_first_signer_utxo,
    },
    wallet_abi::support::{asset_auth_finalizer, policy_fee_source},
};

fn create_asset_auth_output(
    harness: &WalletAbiHarness,
    asset_auth: &AssetAuth,
    locked_amount: u64,
) -> Result<crate::common::process_req::ProcessedRequest> {
    let policy_asset = harness.network().policy_asset();

    process_wallet_abi_request(
        harness,
        harness
            .tx()
            .wallet_input_exact("locked-input", policy_asset, locked_amount)
            .raw_wallet_input(
                "fee-input",
                policy_fee_source(harness),
                ElementsSequence::ENABLE_LOCKTIME_NO_RBF,
            )
            .raw_output(
                "locked-script",
                LockVariant::Script {
                    script: asset_auth.get_script_pubkey(),
                },
                policy_asset,
                locked_amount,
            )
            .build_create()?,
    )
}

#[simplex::test]
fn wallet_abi_creates_and_unlocks_asset_auth_without_burn(
    context: simplex::TestContext,
) -> Result<()> {
    let locked_amount = 1_000;

    let txid = split_first_signer_utxo(&context, vec![locked_amount, 5_000, 200_000]);
    wait_for_tx(&context, &txid)?;

    let (txid, auth_asset_id) = issue_asset(&context, 1)?;
    wait_for_tx(&context, &txid)?;

    let harness = WalletAbiHarness::from_test_context(context)?;
    let policy_asset = harness.network().policy_asset();

    let asset_auth = AssetAuth::new(AssetAuthParameters {
        asset_id: auth_asset_id,
        asset_amount: 1,
        with_asset_burn: false,
        network: *harness.context().get_network(),
    });

    let created = create_asset_auth_output(&harness, &asset_auth, locked_amount)?;
    let locked_script = created.output("locked-script")?;

    let processed = process_wallet_abi_request(
        &harness,
        harness
            .tx()
            .provided_input(
                "locked-script",
                &locked_script,
                InputUnblinding::Explicit,
                asset_auth_finalizer(&harness, &asset_auth)?,
            )
            .wallet_input_exact("auth-input", auth_asset_id, 1)
            .raw_wallet_input(
                "fee-input",
                policy_fee_source(&harness),
                ElementsSequence::ENABLE_LOCKTIME_NO_RBF,
            )
            .explicit_output(
                "unlocked-output",
                harness.signer_script(),
                policy_asset,
                locked_amount,
            )
            .explicit_output("returned-auth", harness.signer_script(), auth_asset_id, 1)
            .build_create()?,
    )?;

    let unlocked_output = processed.output("unlocked-output")?;
    let returned_auth = processed.output("returned-auth")?;

    assert!(
        processed
            .tx
            .input
            .iter()
            .any(|input| input.previous_output == locked_script.outpoint)
    );
    assert_eq!(unlocked_output.outpoint.vout, 0);
    assert_eq!(returned_auth.outpoint.vout, 1);
    assert_eq!(unlocked_output.asset_id(), policy_asset);
    assert_eq!(unlocked_output.amount(), locked_amount);
    assert_eq!(unlocked_output.txout.script_pubkey, harness.signer_script());
    assert_eq!(returned_auth.asset_id(), auth_asset_id);
    assert_eq!(returned_auth.amount(), 1);
    assert_eq!(returned_auth.txout.script_pubkey, harness.signer_script());

    Ok(())
}

#[simplex::test]
fn wallet_abi_creates_and_unlocks_asset_auth_with_burn(
    context: simplex::TestContext,
) -> Result<()> {
    let locked_amount = 1_000;

    let txid = split_first_signer_utxo(&context, vec![locked_amount, 5_000, 200_000]);
    wait_for_tx(&context, &txid)?;

    let (txid, auth_asset_id) = issue_asset(&context, 1)?;
    wait_for_tx(&context, &txid)?;

    let harness = WalletAbiHarness::from_test_context(context)?;
    let policy_asset = harness.network().policy_asset();

    let asset_auth = AssetAuth::new(AssetAuthParameters {
        asset_id: auth_asset_id,
        asset_amount: 1,
        with_asset_burn: true,
        network: *harness.context().get_network(),
    });

    let created = create_asset_auth_output(&harness, &asset_auth, locked_amount)?;
    let locked_script = created.output("locked-script")?;

    let processed = process_wallet_abi_request(
        &harness,
        harness
            .tx()
            .provided_input(
                "locked-script",
                &locked_script,
                InputUnblinding::Explicit,
                asset_auth_finalizer(&harness, &asset_auth)?,
            )
            .wallet_input_exact("auth-input", auth_asset_id, 1)
            .raw_wallet_input(
                "fee-input",
                policy_fee_source(&harness),
                ElementsSequence::ENABLE_LOCKTIME_NO_RBF,
            )
            .explicit_output(
                "unlocked-output",
                harness.signer_script(),
                policy_asset,
                locked_amount,
            )
            .raw_output(
                "burned-auth",
                LockVariant::Script {
                    script: Script::new_op_return(b"burn"),
                },
                auth_asset_id,
                1,
            )
            .build_create()?,
    )?;

    let unlocked_output = processed.output("unlocked-output")?;
    let burned_auth = processed.output("burned-auth")?;

    assert!(
        processed
            .tx
            .input
            .iter()
            .any(|input| input.previous_output == locked_script.outpoint)
    );
    assert_eq!(unlocked_output.outpoint.vout, 0);
    assert_eq!(burned_auth.outpoint.vout, 1);
    assert_eq!(unlocked_output.asset_id(), policy_asset);
    assert_eq!(unlocked_output.amount(), locked_amount);
    assert_eq!(unlocked_output.txout.script_pubkey, harness.signer_script());
    assert_burn_output(&burned_auth.txout, auth_asset_id, 1);

    Ok(())
}
