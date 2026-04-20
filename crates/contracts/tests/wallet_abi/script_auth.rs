use anyhow::Result;
use lending_contracts::{
    artifacts::script_auth::{ScriptAuthProgram, derived_script_auth::ScriptAuthArguments},
    programs::{ScriptAuth, ScriptAuthParameters, program::SimplexProgram},
};
use simplex::{
    program::{ArgumentsTrait, WitnessTrait},
    utils::hash_script,
    wallet_abi::{
        FinalizerSpec, InputUnblinding, LockVariant, SimfArguments, SimfWitness, WalletAbiHarness,
    },
};

use crate::common::process_req::process_wallet_abi_request;

pub(crate) fn script_auth_finalizer(
    harness: &WalletAbiHarness,
    script_auth: &ScriptAuth,
    input_script_index: u32,
) -> Result<FinalizerSpec> {
    Ok(harness.simf_finalizer(
        ScriptAuthProgram::SOURCE,
        &SimfArguments::new(
            ScriptAuthArguments::from(*script_auth.get_script_auth_parameters()).build_arguments(),
        ),
        &SimfWitness::new(ScriptAuth::get_script_auth_witness(input_script_index).build_witness()),
    )?)
}

#[simplex::test]
fn wallet_abi_creates_and_unlocks_script_auth(context: simplex::TestContext) -> Result<()> {
    let harness = WalletAbiHarness::from_test_context(context)?;
    let policy_asset = harness.network().policy_asset();
    let locked_amount = 1_000;

    let _ = harness.fund_signer_lbtc(5_000)?;
    let _ = harness.fund_signer_lbtc(200_000)?;

    let signer_script = harness.signer_script();
    let script_auth = ScriptAuth::new(ScriptAuthParameters {
        script_hash: hash_script(&signer_script),
        network: *harness.context().get_network(),
    });

    let created = process_wallet_abi_request(
        &harness,
        harness
            .tx()
            .raw_output(
                "locked-script",
                LockVariant::Script {
                    script: script_auth.get_script_pubkey(),
                },
                policy_asset,
                locked_amount,
            )
            .build_create()?,
    )?;

    let locked_script = created.output("locked-script")?;
    assert_eq!(locked_script.outpoint.vout, 0);
    assert_eq!(locked_script.asset_id(), policy_asset);
    assert_eq!(locked_script.amount(), locked_amount);
    assert_eq!(
        locked_script.txout.script_pubkey,
        script_auth.get_script_pubkey()
    );
    assert!(
        created.tx.output.len() > 2,
        "expected fee and change outputs when oversized wallet inputs are selected"
    );

    let unlocked = process_wallet_abi_request(
        &harness,
        harness
            .tx()
            .provided_input(
                "locked-script",
                &locked_script,
                InputUnblinding::Explicit,
                script_auth_finalizer(&harness, &script_auth, 1)?,
            )
            .explicit_output(
                "unlocked-output",
                signer_script.clone(),
                policy_asset,
                locked_amount,
            )
            .build_create()?,
    )?;

    let unlocked_output = unlocked.output("unlocked-output")?;
    assert!(
        unlocked
            .tx
            .input
            .iter()
            .any(|input| input.previous_output == locked_script.outpoint)
    );
    assert_eq!(unlocked_output.outpoint.vout, 0);
    assert_eq!(unlocked_output.asset_id(), policy_asset);
    assert_eq!(unlocked_output.amount(), locked_amount);
    assert_eq!(unlocked_output.txout.script_pubkey, signer_script);

    Ok(())
}
