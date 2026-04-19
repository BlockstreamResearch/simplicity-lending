use anyhow::Result;
use simplex::wallet_abi::{ElementsSequence, InputUnblinding, LockVariant, WalletAbiHarness};

use crate::{
    common::{
        asserts::assert_burn_output, flows::pre_lock_flow::setup_lending_fixture,
        process_req::process_wallet_abi_request, tx_steps::wait_for_tx,
    },
    wallet_abi::support::{
        fetch_output_utxo, lending_liquidation_finalizer, policy_fee_source, script_auth_finalizer,
        script_auth_from_lending,
    },
};

#[simplex::test]
fn wallet_abi_liquidates_loan_after_expiry(context: simplex::TestContext) -> Result<()> {
    let fixture = setup_lending_fixture(&context)?;
    wait_for_tx(&context, &fixture.lending_txid)?;

    let lending_parameters = *fixture.lending.get_lending_parameters();
    let parameters_script_auth = script_auth_from_lending(&fixture.lending);
    let lending_utxo = fetch_output_utxo(&context, fixture.lending_txid, 0)?;
    let first_parameters_nft_utxo = fetch_output_utxo(&context, fixture.lending_txid, 2)?;
    let second_parameters_nft_utxo = fetch_output_utxo(&context, fixture.lending_txid, 3)?;

    let harness = WalletAbiHarness::from_test_context(context)?;
    harness.mine_to_height(lending_parameters.offer_parameters.loan_expiration_time + 1)?;

    let parameters_finalizer = script_auth_finalizer(&harness, &parameters_script_auth, 0)?;
    let processed = process_wallet_abi_request(
        &harness,
        harness
            .tx()
            .provided_input(
                "locked-collateral",
                &lending_utxo,
                InputUnblinding::Explicit,
                lending_liquidation_finalizer(&harness, &fixture.lending)?,
            )
            .provided_input(
                "first-parameter-nft",
                &first_parameters_nft_utxo,
                InputUnblinding::Explicit,
                parameters_finalizer.clone(),
            )
            .provided_input(
                "second-parameter-nft",
                &second_parameters_nft_utxo,
                InputUnblinding::Explicit,
                parameters_finalizer,
            )
            .wallet_input_exact("lender-nft", lending_parameters.lender_nft_asset_id, 1)
            .raw_wallet_input(
                "fee-input",
                policy_fee_source(&harness),
                ElementsSequence::ENABLE_LOCKTIME_NO_RBF,
            )
            .lock_time_height(lending_parameters.offer_parameters.loan_expiration_time)?
            .explicit_output(
                "returned-collateral",
                harness.signer_script(),
                lending_parameters.collateral_asset_id,
                lending_parameters.offer_parameters.collateral_amount,
            )
            .raw_output(
                "burned-first-parameter-nft",
                LockVariant::Script {
                    script: simplex::simplicityhl::elements::Script::new_op_return(b"burn"),
                },
                lending_parameters.first_parameters_nft_asset_id,
                first_parameters_nft_utxo.amount(),
            )
            .raw_output(
                "burned-second-parameter-nft",
                LockVariant::Script {
                    script: simplex::simplicityhl::elements::Script::new_op_return(b"burn"),
                },
                lending_parameters.second_parameters_nft_asset_id,
                second_parameters_nft_utxo.amount(),
            )
            .raw_output(
                "burned-lender-nft",
                LockVariant::Script {
                    script: simplex::simplicityhl::elements::Script::new_op_return(b"burn"),
                },
                lending_parameters.lender_nft_asset_id,
                1,
            )
            .build_create()?,
    )?;

    let returned_collateral = processed.output("returned-collateral")?;
    let burned_first_parameters_nft = processed.output("burned-first-parameter-nft")?;
    let burned_second_parameters_nft = processed.output("burned-second-parameter-nft")?;
    let burned_lender_nft = processed.output("burned-lender-nft")?;

    assert_eq!(
        processed.tx.lock_time,
        simplex::simplicityhl::elements::LockTime::from_height(
            lending_parameters.offer_parameters.loan_expiration_time,
        )
        .expect("height locktime")
    );
    assert_eq!(returned_collateral.outpoint.vout, 0);
    assert_eq!(
        returned_collateral.txout.script_pubkey,
        harness.signer_script()
    );
    assert_eq!(
        returned_collateral.amount(),
        lending_parameters.offer_parameters.collateral_amount
    );
    assert_burn_output(
        &burned_first_parameters_nft.txout,
        lending_parameters.first_parameters_nft_asset_id,
        first_parameters_nft_utxo.amount(),
    );
    assert_burn_output(
        &burned_second_parameters_nft.txout,
        lending_parameters.second_parameters_nft_asset_id,
        second_parameters_nft_utxo.amount(),
    );
    assert_burn_output(
        &burned_lender_nft.txout,
        lending_parameters.lender_nft_asset_id,
        1,
    );

    Ok(())
}

#[simplex::test]
fn wallet_abi_rejects_loan_liquidation_before_expiry(context: simplex::TestContext) -> Result<()> {
    let fixture = setup_lending_fixture(&context)?;
    wait_for_tx(&context, &fixture.lending_txid)?;

    let lending_parameters = *fixture.lending.get_lending_parameters();
    let parameters_script_auth = script_auth_from_lending(&fixture.lending);
    let lending_utxo = fetch_output_utxo(&context, fixture.lending_txid, 0)?;
    let first_parameters_nft_utxo = fetch_output_utxo(&context, fixture.lending_txid, 2)?;
    let second_parameters_nft_utxo = fetch_output_utxo(&context, fixture.lending_txid, 3)?;

    let harness = WalletAbiHarness::from_test_context(context)?;
    assert!(harness.current_height()? < lending_parameters.offer_parameters.loan_expiration_time);

    let parameters_finalizer = script_auth_finalizer(&harness, &parameters_script_auth, 0)?;
    let request = harness
        .tx()
        .provided_input(
            "locked-collateral",
            &lending_utxo,
            InputUnblinding::Explicit,
            lending_liquidation_finalizer(&harness, &fixture.lending)?,
        )
        .provided_input(
            "first-parameter-nft",
            &first_parameters_nft_utxo,
            InputUnblinding::Explicit,
            parameters_finalizer.clone(),
        )
        .provided_input(
            "second-parameter-nft",
            &second_parameters_nft_utxo,
            InputUnblinding::Explicit,
            parameters_finalizer,
        )
        .wallet_input_exact("lender-nft", lending_parameters.lender_nft_asset_id, 1)
        .raw_wallet_input(
            "fee-input",
            policy_fee_source(&harness),
            ElementsSequence::ENABLE_LOCKTIME_NO_RBF,
        )
        .lock_time_height(lending_parameters.offer_parameters.loan_expiration_time)?
        .explicit_output(
            "returned-collateral",
            harness.signer_script(),
            lending_parameters.collateral_asset_id,
            lending_parameters.offer_parameters.collateral_amount,
        )
        .raw_output(
            "burned-first-parameter-nft",
            LockVariant::Script {
                script: simplex::simplicityhl::elements::Script::new_op_return(b"burn"),
            },
            lending_parameters.first_parameters_nft_asset_id,
            first_parameters_nft_utxo.amount(),
        )
        .raw_output(
            "burned-second-parameter-nft",
            LockVariant::Script {
                script: simplex::simplicityhl::elements::Script::new_op_return(b"burn"),
            },
            lending_parameters.second_parameters_nft_asset_id,
            second_parameters_nft_utxo.amount(),
        )
        .raw_output(
            "burned-lender-nft",
            LockVariant::Script {
                script: simplex::simplicityhl::elements::Script::new_op_return(b"burn"),
            },
            lending_parameters.lender_nft_asset_id,
            1,
        )
        .build_create()?;

    assert!(harness.process_request(request).is_err());

    Ok(())
}
