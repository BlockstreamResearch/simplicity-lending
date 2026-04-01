use lending_contracts::{
    programs::{Lending, LendingParameters},
    transactions::{
        asset_auth::unlock_asset_auth,
        core::SimplexInput,
        lending::{liquidate_loan, repay_loan},
    },
};
use simplex::{
    TestContext,
    simplicityhl::elements::{OutPoint, Txid},
    transaction::{FinalTransaction, PartialInput, PartialOutput, RequiredSignature, UTXO},
};

use crate::lending_tests::common::{
    tx_steps::{finalize_and_broadcast, finalize_strict_and_broadcast, mine_blocks_with_self_send},
    wallet::{AmountFilter, filter_signer_utxos_by_asset_and_amount},
};

pub(super) use super::common::flows::pre_lock_flow::setup_lending_fixture;

pub(super) fn mine_until_height(context: &TestContext, target_height: u32) -> anyhow::Result<()> {
    let current_height = context.get_default_provider().fetch_tip_height()?;
    if current_height < target_height {
        let blocks_to_mine = target_height - current_height;
        let _ = mine_blocks_with_self_send(context, blocks_to_mine, 1_000)?;
    }

    Ok(())
}

pub(super) fn repay_lending_tx(
    context: &TestContext,
    lending: Lending,
    lending_txid: Txid,
) -> anyhow::Result<Txid> {
    let provider = context.get_default_provider();
    let signer = context.get_default_signer();

    let lending_parameters = lending.get_lending_parameters();
    let lending_creation_tx = provider.fetch_transaction(&lending_txid)?;

    let borrower_nft_utxos = signer.get_utxos_asset(lending_parameters.borrower_nft_asset_id)?;

    assert!(
        borrower_nft_utxos.len() == 1,
        "Invalid BorrowerNFT UTXOs count"
    );

    let borrower_nft_utxo = borrower_nft_utxos.first().unwrap();

    let principal_utxos = signer.get_utxos_asset(lending_parameters.principal_asset_id)?;

    let mut principal_inputs: Vec<SimplexInput> = Vec::new();
    let mut total_inputs_amount = 0;

    let principal_with_interest = lending_parameters
        .offer_parameters
        .calculate_principal_with_interest();

    for utxo in principal_utxos {
        let input = SimplexInput::new(&utxo, RequiredSignature::NativeEcdsa);

        total_inputs_amount += input.explicit_amount();
        principal_inputs.push(input);

        if total_inputs_amount >= principal_with_interest {
            break;
        }
    }

    let mut ft = repay_loan(
        UTXO {
            outpoint: OutPoint::new(lending_txid, 0),
            txout: lending_creation_tx.output[0].clone(),
            secrets: None,
        },
        UTXO {
            outpoint: OutPoint::new(lending_txid, 2),
            txout: lending_creation_tx.output[2].clone(),
            secrets: None,
        },
        UTXO {
            outpoint: OutPoint::new(lending_txid, 3),
            txout: lending_creation_tx.output[3].clone(),
            secrets: None,
        },
        &SimplexInput::new(borrower_nft_utxo, RequiredSignature::NativeEcdsa),
        principal_inputs,
        PartialOutput::new(
            signer.get_address().unwrap().script_pubkey(),
            lending_parameters.offer_parameters.collateral_amount,
            lending_parameters.collateral_asset_id,
        ),
        lending,
    )?;

    let signer_policy_utxos = filter_signer_utxos_by_asset_and_amount(
        signer,
        context.get_network().policy_asset(),
        100_000,
        AmountFilter::LessThan,
    );
    let fee_utxo = signer_policy_utxos.first().unwrap();

    ft.add_input(
        PartialInput::new(fee_utxo.clone()),
        RequiredSignature::NativeEcdsa,
    )?;

    finalize_strict_and_broadcast(context, &ft)
}

pub(super) fn get_lending_liquidation_tx(
    context: &TestContext,
    lending: Lending,
    lending_txid: Txid,
) -> anyhow::Result<FinalTransaction> {
    let provider = context.get_default_provider();
    let signer = context.get_default_signer();

    let lending_parameters = lending.get_lending_parameters();
    let lending_creation_tx = provider.fetch_transaction(&lending_txid)?;

    let lender_nft_utxos = signer.get_utxos_asset(lending_parameters.lender_nft_asset_id)?;

    assert!(
        lender_nft_utxos.len() == 1,
        "Invalid BorrowerNFT UTXOs count"
    );

    let lender_nft_utxo = lender_nft_utxos.first().unwrap();

    let mut ft = liquidate_loan(
        UTXO {
            outpoint: OutPoint::new(lending_txid, 0),
            txout: lending_creation_tx.output[0].clone(),
            secrets: None,
        },
        UTXO {
            outpoint: OutPoint::new(lending_txid, 2),
            txout: lending_creation_tx.output[2].clone(),
            secrets: None,
        },
        UTXO {
            outpoint: OutPoint::new(lending_txid, 3),
            txout: lending_creation_tx.output[3].clone(),
            secrets: None,
        },
        &SimplexInput::new(lender_nft_utxo, RequiredSignature::NativeEcdsa),
        PartialOutput::new(
            signer.get_address().unwrap().script_pubkey(),
            lending_parameters.offer_parameters.collateral_amount,
            lending_parameters.collateral_asset_id,
        ),
        lending,
    )?;

    let signer_policy_utxos = filter_signer_utxos_by_asset_and_amount(
        signer,
        context.get_network().policy_asset(),
        100_000,
        AmountFilter::LessThan,
    );
    let fee_utxo = signer_policy_utxos.first().unwrap();

    ft.add_input(
        PartialInput::new(fee_utxo.clone()),
        RequiredSignature::NativeEcdsa,
    )?;

    Ok(ft)
}

pub(super) fn claim_lender_principal(
    context: &TestContext,
    lending_parameters: &LendingParameters,
    repayment_txid: Txid,
) -> anyhow::Result<Txid> {
    let provider = context.get_default_provider();
    let signer = context.get_default_signer();

    let loan_repayment_tx = provider.fetch_transaction(&repayment_txid)?;

    let lender_nft_utxos = signer.get_utxos_asset(lending_parameters.lender_nft_asset_id)?;

    assert!(
        lender_nft_utxos.len() == 1,
        "Invalid BorrowerNFT UTXOs count"
    );

    let lender_nft_utxo = lender_nft_utxos.first().unwrap();

    let principal_asset_auth = lending_parameters.get_lender_principal_asset_auth();

    let principal_with_interest = lending_parameters
        .offer_parameters
        .calculate_principal_with_interest();

    let ft = unlock_asset_auth(
        UTXO {
            outpoint: OutPoint::new(repayment_txid, 1),
            txout: loan_repayment_tx.output[1].clone(),
            secrets: None,
        },
        &SimplexInput::new(lender_nft_utxo, RequiredSignature::NativeEcdsa),
        PartialOutput::new(
            signer.get_address().unwrap().script_pubkey(),
            principal_with_interest,
            lending_parameters.principal_asset_id,
        ),
        principal_asset_auth,
    )?;

    finalize_and_broadcast(context, &ft)
}
