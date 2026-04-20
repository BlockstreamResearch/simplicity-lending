use anyhow::Result;
use lending_contracts::programs::{Lending, ScriptAuth, program::SimplexProgram};
use simplex::wallet_abi::{ElementsSequence, InputUnblinding, WalletAbiHarness};

use crate::{
    common::{
        flows::pre_lock_flow::setup_pre_lock, process_req::process_wallet_abi_request,
        tx_steps::wait_for_tx, utxo::fetch_output_utxo,
    },
    wallet_abi::support::{
        ensure_exact_asset_utxo, lending_repayment_finalizer, policy_fee_source,
        pre_lock_lending_creation_finalizer, script_auth_finalizer, script_auth_from_lending,
    },
};

#[simplex::test]
fn wallet_abi_creates_lending_from_pre_lock(context: simplex::TestContext) -> Result<()> {
    let (pre_lock_txid, pre_lock) = setup_pre_lock(&context)?;
    wait_for_tx(&context, &pre_lock_txid)?;

    let pre_lock_parameters = *pre_lock.get_pre_lock_parameters();
    let borrower_script = context.get_default_signer().get_address().script_pubkey();
    ensure_exact_asset_utxo(
        &context,
        pre_lock_parameters.principal_asset_id,
        pre_lock_parameters.offer_parameters.principal_amount,
    )?;

    let lending = Lending::new(pre_lock_parameters.into());
    let utility_nfts_script_auth = ScriptAuth::from_simplex_program(&pre_lock);
    let parameter_nfts_script_auth = script_auth_from_lending(&lending);
    let collateral_utxo = fetch_output_utxo(&context, pre_lock_txid, 0)?;
    let first_parameters_nft_utxo = fetch_output_utxo(&context, pre_lock_txid, 1)?;
    let second_parameters_nft_utxo = fetch_output_utxo(&context, pre_lock_txid, 2)?;
    let borrower_nft_utxo = fetch_output_utxo(&context, pre_lock_txid, 3)?;
    let lender_nft_utxo = fetch_output_utxo(&context, pre_lock_txid, 4)?;

    let harness = WalletAbiHarness::from_test_context(context)?;
    let utility_nfts_finalizer = script_auth_finalizer(&harness, &utility_nfts_script_auth, 0)?;
    let parameter_nfts_finalizer = script_auth_finalizer(&harness, &parameter_nfts_script_auth, 0)?;
    let lending_finalizer = lending_repayment_finalizer(&harness, &lending)?;

    let processed = process_wallet_abi_request(
        &harness,
        harness
            .tx()
            .provided_input(
                "locked-collateral",
                &collateral_utxo,
                InputUnblinding::Explicit,
                pre_lock_lending_creation_finalizer(&harness, &pre_lock)?,
            )
            .provided_input(
                "first-parameter-nft",
                &first_parameters_nft_utxo,
                InputUnblinding::Explicit,
                utility_nfts_finalizer.clone(),
            )
            .provided_input(
                "second-parameter-nft",
                &second_parameters_nft_utxo,
                InputUnblinding::Explicit,
                utility_nfts_finalizer.clone(),
            )
            .provided_input(
                "borrower-nft",
                &borrower_nft_utxo,
                InputUnblinding::Explicit,
                utility_nfts_finalizer.clone(),
            )
            .provided_input(
                "lender-nft",
                &lender_nft_utxo,
                InputUnblinding::Explicit,
                utility_nfts_finalizer.clone(),
            )
            .wallet_input_exact(
                "principal-input",
                pre_lock_parameters.principal_asset_id,
                pre_lock_parameters.offer_parameters.principal_amount,
            )
            .raw_wallet_input(
                "fee-input",
                policy_fee_source(&harness),
                ElementsSequence::ENABLE_LOCKTIME_NO_RBF,
            )
            .finalizer_output(
                "locked-collateral",
                lending_finalizer.clone(),
                pre_lock_parameters.collateral_asset_id,
                pre_lock_parameters.offer_parameters.collateral_amount,
            )
            .explicit_output(
                "borrower-principal",
                borrower_script.clone(),
                pre_lock_parameters.principal_asset_id,
                pre_lock_parameters.offer_parameters.principal_amount,
            )
            .finalizer_output(
                "locked-first-parameter-nft",
                parameter_nfts_finalizer.clone(),
                pre_lock_parameters.first_parameters_nft_asset_id,
                first_parameters_nft_utxo.amount(),
            )
            .finalizer_output(
                "locked-second-parameter-nft",
                parameter_nfts_finalizer,
                pre_lock_parameters.second_parameters_nft_asset_id,
                second_parameters_nft_utxo.amount(),
            )
            .explicit_output(
                "borrower-nft-output",
                borrower_script.clone(),
                pre_lock_parameters.borrower_nft_asset_id,
                1,
            )
            .explicit_output(
                "lender-nft-output",
                harness.signer_script(),
                pre_lock_parameters.lender_nft_asset_id,
                1,
            )
            .build_create()?,
    )?;

    let locked_collateral = processed.output("locked-collateral")?;
    let borrower_principal = processed.output("borrower-principal")?;
    let locked_first_parameters_nft = processed.output("locked-first-parameter-nft")?;
    let locked_second_parameters_nft = processed.output("locked-second-parameter-nft")?;
    let borrower_nft_output = processed.output("borrower-nft-output")?;
    let lender_nft_output = processed.output("lender-nft-output")?;

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

    assert_eq!(locked_collateral.outpoint.vout, 0);
    assert_eq!(borrower_principal.outpoint.vout, 1);
    assert_eq!(locked_first_parameters_nft.outpoint.vout, 2);
    assert_eq!(locked_second_parameters_nft.outpoint.vout, 3);
    assert_eq!(borrower_nft_output.outpoint.vout, 4);
    assert_eq!(lender_nft_output.outpoint.vout, 5);

    assert_eq!(
        locked_collateral.txout.script_pubkey,
        lending.get_script_pubkey()
    );
    assert_eq!(borrower_principal.txout.script_pubkey, borrower_script);
    assert_eq!(
        borrower_principal.asset_id(),
        pre_lock_parameters.principal_asset_id
    );
    assert_eq!(
        borrower_principal.amount(),
        pre_lock_parameters.offer_parameters.principal_amount
    );
    assert_eq!(
        locked_first_parameters_nft.txout.script_pubkey,
        parameter_nfts_script_auth.get_script_pubkey()
    );
    assert_eq!(
        locked_second_parameters_nft.txout.script_pubkey,
        parameter_nfts_script_auth.get_script_pubkey()
    );
    assert_eq!(borrower_nft_output.txout.script_pubkey, borrower_script);
    assert_eq!(
        lender_nft_output.txout.script_pubkey,
        harness.signer_script()
    );

    Ok(())
}
