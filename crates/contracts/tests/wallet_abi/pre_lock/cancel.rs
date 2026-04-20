use anyhow::Result;
use lending_contracts::programs::ScriptAuth;
use simplex::{
    simplicityhl::elements::Script,
    wallet_abi::{InputUnblinding, LockVariant, WalletAbiHarness},
};

use crate::{
    common::{
        asserts::assert_burn_output, flows::pre_lock_flow::setup_pre_lock,
        process_req::process_wallet_abi_request, tx_steps::wait_for_tx, utxo::fetch_output_utxo,
    },
    wallet_abi::{pre_lock::pre_lock_cancellation_finalizer, script_auth::script_auth_finalizer},
};

#[simplex::test]
fn wallet_abi_cancels_pre_lock(context: simplex::TestContext) -> Result<()> {
    let (pre_lock_txid, pre_lock) = setup_pre_lock(&context)?;
    wait_for_tx(&context, &pre_lock_txid)?;

    let borrower_script = context.get_default_signer().get_address().script_pubkey();
    let utility_nfts_script_auth = ScriptAuth::from_simplex_program(&pre_lock);
    let collateral_utxo = fetch_output_utxo(&context, pre_lock_txid, 0)?;
    let first_parameters_nft_utxo = fetch_output_utxo(&context, pre_lock_txid, 1)?;
    let second_parameters_nft_utxo = fetch_output_utxo(&context, pre_lock_txid, 2)?;
    let borrower_nft_utxo = fetch_output_utxo(&context, pre_lock_txid, 3)?;
    let lender_nft_utxo = fetch_output_utxo(&context, pre_lock_txid, 4)?;

    let harness = WalletAbiHarness::from_test_context(context)?;
    let script_auth_finalizer = script_auth_finalizer(&harness, &utility_nfts_script_auth, 0)?;
    let mut request = harness
        .tx()
        .provided_input(
            "locked-collateral",
            &collateral_utxo,
            InputUnblinding::Explicit,
            pre_lock_cancellation_finalizer(&harness, &pre_lock)?,
        )
        .provided_input(
            "first-parameter-nft",
            &first_parameters_nft_utxo,
            InputUnblinding::Explicit,
            script_auth_finalizer.clone(),
        )
        .provided_input(
            "second-parameter-nft",
            &second_parameters_nft_utxo,
            InputUnblinding::Explicit,
            script_auth_finalizer.clone(),
        )
        .provided_input(
            "borrower-nft",
            &borrower_nft_utxo,
            InputUnblinding::Explicit,
            script_auth_finalizer.clone(),
        )
        .provided_input(
            "lender-nft",
            &lender_nft_utxo,
            InputUnblinding::Explicit,
            script_auth_finalizer,
        )
        .explicit_output(
            "returned-collateral",
            borrower_script.clone(),
            pre_lock.get_pre_lock_parameters().collateral_asset_id,
            pre_lock
                .get_pre_lock_parameters()
                .offer_parameters
                .collateral_amount,
        )
        .raw_output(
            "burned-first-parameter-nft",
            LockVariant::Script {
                script: Script::new_op_return(b"burn"),
            },
            pre_lock
                .get_pre_lock_parameters()
                .first_parameters_nft_asset_id,
            first_parameters_nft_utxo.amount(),
        )
        .raw_output(
            "burned-second-parameter-nft",
            LockVariant::Script {
                script: Script::new_op_return(b"burn"),
            },
            pre_lock
                .get_pre_lock_parameters()
                .second_parameters_nft_asset_id,
            second_parameters_nft_utxo.amount(),
        )
        .raw_output(
            "burned-borrower-nft",
            LockVariant::Script {
                script: Script::new_op_return(b"burn"),
            },
            pre_lock.get_pre_lock_parameters().borrower_nft_asset_id,
            1,
        )
        .raw_output(
            "burned-lender-nft",
            LockVariant::Script {
                script: Script::new_op_return(b"burn"),
            },
            pre_lock.get_pre_lock_parameters().lender_nft_asset_id,
            1,
        )
        .build_create()?;
    request.broadcast = false;

    let processed = process_wallet_abi_request(&harness, request)?;

    let returned_collateral = processed.output("returned-collateral")?;
    let burned_first_parameters_nft = processed.output("burned-first-parameter-nft")?;
    let burned_second_parameters_nft = processed.output("burned-second-parameter-nft")?;
    let burned_borrower_nft = processed.output("burned-borrower-nft")?;
    let burned_lender_nft = processed.output("burned-lender-nft")?;

    for outpoint in [
        collateral_utxo.outpoint,
        first_parameters_nft_utxo.outpoint,
        second_parameters_nft_utxo.outpoint,
        borrower_nft_utxo.outpoint,
        lender_nft_utxo.outpoint,
    ] {
        assert!(
            processed
                .tx
                .input
                .iter()
                .any(|input| input.previous_output == outpoint)
        );
    }

    assert_eq!(returned_collateral.outpoint.vout, 0);
    assert_eq!(returned_collateral.txout.script_pubkey, borrower_script);
    assert_eq!(
        returned_collateral.asset_id(),
        pre_lock.get_pre_lock_parameters().collateral_asset_id
    );
    assert_eq!(
        returned_collateral.amount(),
        pre_lock
            .get_pre_lock_parameters()
            .offer_parameters
            .collateral_amount
    );

    assert_burn_output(
        &burned_first_parameters_nft.txout,
        pre_lock
            .get_pre_lock_parameters()
            .first_parameters_nft_asset_id,
        first_parameters_nft_utxo.amount(),
    );
    assert_burn_output(
        &burned_second_parameters_nft.txout,
        pre_lock
            .get_pre_lock_parameters()
            .second_parameters_nft_asset_id,
        second_parameters_nft_utxo.amount(),
    );
    assert_burn_output(
        &burned_borrower_nft.txout,
        pre_lock.get_pre_lock_parameters().borrower_nft_asset_id,
        1,
    );
    assert_burn_output(
        &burned_lender_nft.txout,
        pre_lock.get_pre_lock_parameters().lender_nft_asset_id,
        1,
    );

    Ok(())
}
