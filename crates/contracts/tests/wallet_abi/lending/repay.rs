use anyhow::Result;
use lending_contracts::programs::{ScriptAuth, program::SimplexProgram};
use simplex::{
    simplicityhl::elements::Script,
    wallet_abi::{
        AmountFilter, AssetFilter, InputSchema, InputUnblinding, LockFilter, LockVariant,
        UTXOSource, WalletAbiHarness, WalletSourceFilter,
    },
};

use crate::{
    common::{
        asserts::assert_burn_output, flows::pre_lock_flow::setup_lending_fixture,
        process_req::process_wallet_abi_request, tx_steps::wait_for_tx, utxo::fetch_output_utxo,
    },
    wallet_abi::{
        asset_auth::asset_auth_finalizer, lending::lending_repayment_finalizer,
        script_auth::script_auth_finalizer,
    },
};

#[simplex::test]
fn wallet_abi_repays_loan(context: simplex::TestContext) -> Result<()> {
    let fixture = setup_lending_fixture(&context)?;
    wait_for_tx(&context, &fixture.lending_txid)?;

    let lending_parameters = *fixture.lending.get_lending_parameters();
    let principal_with_interest = lending_parameters
        .offer_parameters
        .calculate_principal_with_interest();

    let parameters_script_auth = ScriptAuth::from_simplex_program(&fixture.lending);
    let lender_principal_asset_auth = lending_parameters.get_lender_principal_asset_auth();
    let lending_utxo = fetch_output_utxo(&context, fixture.lending_txid, 0)?;
    let first_parameters_nft_utxo = fetch_output_utxo(&context, fixture.lending_txid, 2)?;
    let second_parameters_nft_utxo = fetch_output_utxo(&context, fixture.lending_txid, 3)?;

    let harness = WalletAbiHarness::from_test_context(context)?;
    let parameters_finalizer = script_auth_finalizer(&harness, &parameters_script_auth, 0)?;

    let processed = process_wallet_abi_request(
        &harness,
        harness
            .tx()
            .provided_input(
                "locked-collateral",
                &lending_utxo,
                InputUnblinding::Explicit,
                lending_repayment_finalizer(&harness, &fixture.lending)?,
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
            .raw_input_schema(InputSchema {
                id: "borrower-nft".to_string(),
                utxo_source: UTXOSource::Wallet {
                    filter: WalletSourceFilter {
                        amount: AmountFilter::None,
                        asset: AssetFilter::Exact {
                            asset_id: lending_parameters.borrower_nft_asset_id,
                        },
                        lock: LockFilter::None,
                    },
                },
                ..InputSchema::default()
            })
            .explicit_output(
                "returned-collateral",
                harness.signer_script(),
                lending_parameters.collateral_asset_id,
                lending_parameters.offer_parameters.collateral_amount,
            )
            .finalizer_output(
                "locked-lender-principal",
                asset_auth_finalizer(&harness, &lender_principal_asset_auth)?,
                lending_parameters.principal_asset_id,
                principal_with_interest,
            )
            .raw_output(
                "burned-first-parameter-nft",
                LockVariant::Script {
                    script: Script::new_op_return(b"burn"),
                },
                lending_parameters.first_parameters_nft_asset_id,
                first_parameters_nft_utxo.amount(),
            )
            .raw_output(
                "burned-second-parameter-nft",
                LockVariant::Script {
                    script: Script::new_op_return(b"burn"),
                },
                lending_parameters.second_parameters_nft_asset_id,
                second_parameters_nft_utxo.amount(),
            )
            .raw_output(
                "burned-borrower-nft",
                LockVariant::Script {
                    script: Script::new_op_return(b"burn"),
                },
                lending_parameters.borrower_nft_asset_id,
                1,
            )
            .build_create()?,
    )?;

    let returned_collateral = processed.output("returned-collateral")?;
    let locked_lender_principal = processed.output("locked-lender-principal")?;
    let burned_first_parameters_nft = processed.output("burned-first-parameter-nft")?;
    let burned_second_parameters_nft = processed.output("burned-second-parameter-nft")?;
    let burned_borrower_nft = processed.output("burned-borrower-nft")?;

    for outpoint in [
        lending_utxo.outpoint,
        first_parameters_nft_utxo.outpoint,
        second_parameters_nft_utxo.outpoint,
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
    assert_eq!(locked_lender_principal.outpoint.vout, 1);
    assert_eq!(
        returned_collateral.txout.script_pubkey,
        harness.signer_script()
    );
    assert_eq!(
        returned_collateral.amount(),
        lending_parameters.offer_parameters.collateral_amount
    );
    assert_eq!(
        locked_lender_principal.txout.script_pubkey,
        lender_principal_asset_auth.get_script_pubkey()
    );
    assert_eq!(locked_lender_principal.amount(), principal_with_interest);

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
        &burned_borrower_nft.txout,
        lending_parameters.borrower_nft_asset_id,
        1,
    );

    Ok(())
}
