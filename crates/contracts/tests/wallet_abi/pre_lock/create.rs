use anyhow::Result;
use lending_contracts::{
    programs::{PreLock, PreLockParameters, ScriptAuth, program::SimplexProgram},
    utils::LendingOfferParameters,
};
use simplex::{
    simplicityhl::elements::{AssetId, Script},
    utils::hash_script,
    wallet_abi::{LockVariant, WalletAbiHarness},
};

use crate::common::{
    issuance::{issue_asset, issue_preparation_utxos_tx, issue_utility_nfts_tx},
    process_req::process_wallet_abi_request,
    tx_steps::wait_for_tx,
    wallet::split_first_signer_utxo,
};

const PARAMETER_NFT_DECIMALS: u8 = 1;
const ISSUED_PRINCIPAL_AMOUNT: u64 = 20_000;

fn setup_pre_lock_parameters(context: &simplex::TestContext) -> Result<PreLockParameters> {
    let provider = context.get_default_provider();
    let signer = context.get_default_signer();
    let network = context.get_network();

    let txid = split_first_signer_utxo(context, vec![2_000, 5_000]);
    wait_for_tx(context, &txid)?;

    let (txid, preparation_asset_id) = issue_preparation_utxos_tx(context)?;
    wait_for_tx(context, &txid)?;

    let (txid, principal_asset_id) = issue_asset(context, ISSUED_PRINCIPAL_AMOUNT)?;
    wait_for_tx(context, &txid)?;

    let current_height = provider.fetch_tip_height()?;
    let offer_parameters = LendingOfferParameters {
        collateral_amount: 1_000,
        principal_amount: 5_000,
        loan_expiration_time: current_height + 10,
        principal_interest_rate: 200,
    };

    let utility_nfts_txid =
        issue_utility_nfts_tx(context, &offer_parameters, preparation_asset_id)?;
    wait_for_tx(context, &utility_nfts_txid)?;

    let utility_nfts_tx = provider.fetch_transaction(&utility_nfts_txid)?;
    Ok(PreLockParameters {
        collateral_asset_id: network.policy_asset(),
        principal_asset_id,
        first_parameters_nft_asset_id: utility_nfts_tx.output[0].asset.explicit().unwrap(),
        second_parameters_nft_asset_id: utility_nfts_tx.output[1].asset.explicit().unwrap(),
        borrower_nft_asset_id: utility_nfts_tx.output[2].asset.explicit().unwrap(),
        lender_nft_asset_id: utility_nfts_tx.output[3].asset.explicit().unwrap(),
        offer_parameters,
        borrower_pubkey: signer.get_schnorr_public_key(),
        borrower_output_script_hash: hash_script(&signer.get_address().script_pubkey()),
        network: *network,
    })
}

#[simplex::test]
fn wallet_abi_creates_pre_lock(context: simplex::TestContext) -> Result<()> {
    let pre_lock = PreLock::new(setup_pre_lock_parameters(&context)?);
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
