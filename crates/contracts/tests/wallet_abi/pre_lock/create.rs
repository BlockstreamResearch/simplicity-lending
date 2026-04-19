use anyhow::Result;
use lending_contracts::programs::{PreLock, ScriptAuth, program::SimplexProgram};
use simplex::{
    simplicityhl::elements::{AssetId, Script},
    wallet_abi::{ElementsSequence, LockVariant, WalletAbiHarness},
};

use crate::{
    common::process_req::process_wallet_abi_request,
    wallet_abi::support::{PARAMETER_NFT_DECIMALS, policy_fee_source, setup_pre_lock_wallet_state},
};

#[simplex::test]
fn wallet_abi_creates_pre_lock(context: simplex::TestContext) -> Result<()> {
    let setup = setup_pre_lock_wallet_state(&context)?;
    let pre_lock = PreLock::new(setup.pre_lock_parameters);
    let utility_nfts_script_auth = ScriptAuth::from_simplex_program(&pre_lock);
    let (first_parameters_amount, second_parameters_amount) = pre_lock
        .get_pre_lock_parameters()
        .offer_parameters
        .encode_parameters_nft_amounts(PARAMETER_NFT_DECIMALS)?;
    let op_return_script = Script::new_op_return(&pre_lock.encode_creation_op_return_data());

    let harness = WalletAbiHarness::from_test_context(context)?;
    let processed = process_wallet_abi_request(
        &harness,
        harness
            .tx()
            .wallet_input_exact(
                "collateral-input",
                pre_lock.get_pre_lock_parameters().collateral_asset_id,
                pre_lock
                    .get_pre_lock_parameters()
                    .offer_parameters
                    .collateral_amount,
            )
            .wallet_input_exact(
                "first-parameter-input",
                pre_lock
                    .get_pre_lock_parameters()
                    .first_parameters_nft_asset_id,
                first_parameters_amount,
            )
            .wallet_input_exact(
                "second-parameter-input",
                pre_lock
                    .get_pre_lock_parameters()
                    .second_parameters_nft_asset_id,
                second_parameters_amount,
            )
            .wallet_input_exact(
                "borrower-nft-input",
                pre_lock.get_pre_lock_parameters().borrower_nft_asset_id,
                1,
            )
            .wallet_input_exact(
                "lender-nft-input",
                pre_lock.get_pre_lock_parameters().lender_nft_asset_id,
                1,
            )
            .raw_wallet_input(
                "fee-input",
                policy_fee_source(&harness),
                ElementsSequence::ENABLE_LOCKTIME_NO_RBF,
            )
            .raw_output(
                "locked-collateral",
                LockVariant::Script {
                    script: pre_lock.get_script_pubkey(),
                },
                pre_lock.get_pre_lock_parameters().collateral_asset_id,
                pre_lock
                    .get_pre_lock_parameters()
                    .offer_parameters
                    .collateral_amount,
            )
            .raw_output(
                "locked-first-parameter-nft",
                LockVariant::Script {
                    script: utility_nfts_script_auth.get_script_pubkey(),
                },
                pre_lock
                    .get_pre_lock_parameters()
                    .first_parameters_nft_asset_id,
                first_parameters_amount,
            )
            .raw_output(
                "locked-second-parameter-nft",
                LockVariant::Script {
                    script: utility_nfts_script_auth.get_script_pubkey(),
                },
                pre_lock
                    .get_pre_lock_parameters()
                    .second_parameters_nft_asset_id,
                second_parameters_amount,
            )
            .raw_output(
                "locked-borrower-nft",
                LockVariant::Script {
                    script: utility_nfts_script_auth.get_script_pubkey(),
                },
                pre_lock.get_pre_lock_parameters().borrower_nft_asset_id,
                1,
            )
            .raw_output(
                "locked-lender-nft",
                LockVariant::Script {
                    script: utility_nfts_script_auth.get_script_pubkey(),
                },
                pre_lock.get_pre_lock_parameters().lender_nft_asset_id,
                1,
            )
            .raw_output(
                "creation-op-return",
                LockVariant::Script {
                    script: op_return_script.clone(),
                },
                AssetId::default(),
                0,
            )
            .build_create()?,
    )?;

    let locked_collateral = processed.output("locked-collateral")?;
    let locked_first_parameters_nft = processed.output("locked-first-parameter-nft")?;
    let locked_second_parameters_nft = processed.output("locked-second-parameter-nft")?;
    let locked_borrower_nft = processed.output("locked-borrower-nft")?;
    let locked_lender_nft = processed.output("locked-lender-nft")?;
    let creation_op_return = processed.output("creation-op-return")?;

    assert_eq!(locked_collateral.outpoint.vout, 0);
    assert_eq!(locked_first_parameters_nft.outpoint.vout, 1);
    assert_eq!(locked_second_parameters_nft.outpoint.vout, 2);
    assert_eq!(locked_borrower_nft.outpoint.vout, 3);
    assert_eq!(locked_lender_nft.outpoint.vout, 4);
    assert_eq!(creation_op_return.outpoint.vout, 5);

    assert_eq!(
        locked_collateral.txout.script_pubkey,
        pre_lock.get_script_pubkey()
    );
    assert_eq!(
        locked_collateral.asset_id(),
        pre_lock.get_pre_lock_parameters().collateral_asset_id
    );
    assert_eq!(
        locked_collateral.amount(),
        pre_lock
            .get_pre_lock_parameters()
            .offer_parameters
            .collateral_amount
    );

    assert_eq!(
        locked_first_parameters_nft.txout.script_pubkey,
        utility_nfts_script_auth.get_script_pubkey()
    );
    assert_eq!(
        locked_first_parameters_nft.asset_id(),
        pre_lock
            .get_pre_lock_parameters()
            .first_parameters_nft_asset_id
    );
    assert_eq!(
        locked_first_parameters_nft.amount(),
        first_parameters_amount
    );

    assert_eq!(
        locked_second_parameters_nft.txout.script_pubkey,
        utility_nfts_script_auth.get_script_pubkey()
    );
    assert_eq!(
        locked_second_parameters_nft.asset_id(),
        pre_lock
            .get_pre_lock_parameters()
            .second_parameters_nft_asset_id
    );
    assert_eq!(
        locked_second_parameters_nft.amount(),
        second_parameters_amount
    );

    assert_eq!(
        locked_borrower_nft.txout.script_pubkey,
        utility_nfts_script_auth.get_script_pubkey()
    );
    assert_eq!(
        locked_borrower_nft.asset_id(),
        pre_lock.get_pre_lock_parameters().borrower_nft_asset_id
    );
    assert_eq!(locked_borrower_nft.amount(), 1);

    assert_eq!(
        locked_lender_nft.txout.script_pubkey,
        utility_nfts_script_auth.get_script_pubkey()
    );
    assert_eq!(
        locked_lender_nft.asset_id(),
        pre_lock.get_pre_lock_parameters().lender_nft_asset_id
    );
    assert_eq!(locked_lender_nft.amount(), 1);

    assert_eq!(creation_op_return.txout.script_pubkey, op_return_script);
    assert_eq!(creation_op_return.asset_id(), AssetId::default());
    assert_eq!(creation_op_return.amount(), 0);

    Ok(())
}
