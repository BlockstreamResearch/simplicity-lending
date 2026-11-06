use simplex::signer::Signer;
use simplex::transaction::{FinalTransaction, NativeSignature, PartialInput, PartialOutput};

use lending_contracts::programs::lending::{LendingOffer, LendingOfferParameters, OfferParameters};
use lending_contracts::programs::program::SimplexProgram;

use super::common::wallet::split_first_signer_utxo;
use super::setup::{
    accept_pending_offer, fund_lender, get_active_offer_vaults_utxos, get_pending_offer_utxos,
    partial_repay_offer, setup_issuance_factory, setup_pending_offer,
};

// `paid * COLLATERAL` crosses 2^64 once `paid` exceeds ~1.84e13, while
// `PRINCIPAL * RATE` stays well below it.
const COLLATERAL: u64 = 1_000_000;
const PRINCIPAL: u64 = 100_000_000_000_000;
const RATE: u16 = 1_000;

// `PRINCIPAL * RATE` itself crosses 2^64. The principal stays small enough for the issuance
// transaction to fit into the node's total output limit together with the policy asset change.
const MAX_RATE_PRINCIPAL: u64 = 300_000_000_000_000;
const MAX_RATE: u16 = 65_535;
const MAX_RATE_ISSUED_PRINCIPAL: u64 = 1_000_000_000_000_000;

fn setup_pending(
    context: &simplex::TestContext,
    collateral_amount: u64,
    principal_amount: u64,
    principal_interest_rate: u16,
    issued_principal: u64,
) -> anyhow::Result<(
    simplex::simplicityhl::elements::Txid,
    LendingOffer,
    LendingOfferParameters,
)> {
    let provider = context.get_default_provider();

    split_first_signer_utxo(context, vec![2 * COLLATERAL, 10_000]);

    let issuance_factory = setup_issuance_factory(context)?;
    let current_height = provider.fetch_tip_height()?;

    setup_pending_offer(
        context,
        OfferParameters {
            collateral_amount,
            principal_amount,
            loan_expiration_time: current_height + 60,
            principal_interest_rate,
        },
        issuance_factory,
        issued_principal,
    )
}

fn setup_active(
    context: &simplex::TestContext,
    lender: &Signer,
) -> anyhow::Result<(LendingOffer, LendingOfferParameters)> {
    let (txid, mut offer, params) =
        setup_pending(context, COLLATERAL, PRINCIPAL, RATE, 3 * PRINCIPAL)?;

    fund_lender(context, lender, params.principal_asset_id, PRINCIPAL)?;
    accept_pending_offer(context, &mut offer, txid, lender)?;

    Ok((offer, params))
}

fn full_repay(context: &simplex::TestContext, offer: &mut LendingOffer) -> anyhow::Result<()> {
    let provider = context.get_default_provider();
    let borrower = context.get_default_signer();
    let params = *offer.get_parameters();
    let debt = offer.get_current_debt();

    let offer_utxo = provider.fetch_scripthash_utxos(&offer.get_script_pubkey())?[0].clone();
    let collateral_left = offer_utxo.explicit_amount();
    let borrower_nft = borrower.get_utxos_asset(params.borrower_nft_asset_id)?[0].clone();
    let principal_utxo = borrower
        .get_utxos_asset(params.principal_asset_id)?
        .into_iter()
        .max_by_key(|utxo| utxo.explicit_amount())
        .unwrap();
    let principal_amount = principal_utxo.explicit_amount();
    let (lender_vault, fee_vault) = get_active_offer_vaults_utxos(context, offer)?;

    let mut ft = FinalTransaction::new();

    ft.add_input(
        PartialInput::new(borrower_nft),
        Some(NativeSignature::Ecdsa),
    );
    offer.attach_full_repayment(&mut ft, offer_utxo, lender_vault, fee_vault);
    ft.add_input(
        PartialInput::new(principal_utxo),
        Some(NativeSignature::Ecdsa),
    );
    // The unlocked collateral from partial repayments is confidential, and the signer may pick
    // it to pay the fee, so at least one output has to stay confidential as well.
    ft.add_output(
        PartialOutput::new(
            borrower.get_address().script_pubkey(),
            collateral_left,
            params.collateral_asset_id,
        )
        .with_blinding_key(borrower.get_blinding_public_key()),
    );

    if principal_amount > debt {
        ft.add_output(PartialOutput::new(
            borrower.get_address().script_pubkey(),
            principal_amount - debt,
            params.principal_asset_id,
        ));
    }

    borrower.broadcast(&ft)?.wait()?;

    assert_eq!(offer.get_current_debt(), 0);

    Ok(())
}

fn liquidate(
    context: &simplex::TestContext,
    offer: &LendingOffer,
    lender: &Signer,
) -> anyhow::Result<()> {
    let provider = context.get_default_provider();
    let params = *offer.get_parameters();

    context
        .get_network_utils()
        .mine_until_height((params.offer_parameters.loan_expiration_time + 1) as u64)?;

    let offer_utxo = provider.fetch_scripthash_utxos(&offer.get_script_pubkey())?[0].clone();
    let collateral_left = offer_utxo.explicit_amount();
    let lender_nft = lender.get_utxos_asset(params.lender_nft_asset_id)?[0].clone();

    let mut ft = FinalTransaction::new();

    offer.attach_liquidation(&mut ft, offer_utxo);
    ft.add_input(PartialInput::new(lender_nft), Some(NativeSignature::Ecdsa));
    ft.add_output(PartialOutput::new(
        lender.get_address().script_pubkey(),
        collateral_left,
        params.collateral_asset_id,
    ));

    lender.broadcast(&ft)?.wait()?;

    Ok(())
}

fn offer_collateral(context: &simplex::TestContext, offer: &LendingOffer) -> anyhow::Result<u64> {
    let provider = context.get_default_provider();

    Ok(provider.fetch_scripthash_utxos(&offer.get_script_pubkey())?[0].explicit_amount())
}

#[simplex::test]
fn large_partial_repayment_with_wide_collateral_product_succeeds(
    context: simplex::TestContext,
) -> anyhow::Result<()> {
    let lender = context.random_signer();
    let borrower = context.get_default_signer();
    let (mut offer, _) = setup_active(&context, &lender)?;

    partial_repay_offer(&context, &mut offer, borrower, 50_000_000_000_000)?;

    // floor(5e13 * 1e6 / 1.1e14) = 454_545
    assert_eq!(offer_collateral(&context, &offer)?, COLLATERAL - 454_545);

    Ok(())
}

#[simplex::test]
fn partial_repayment_of_all_but_one_unit_with_wide_product_succeeds(
    context: simplex::TestContext,
) -> anyhow::Result<()> {
    let lender = context.random_signer();
    let borrower = context.get_default_signer();
    let (mut offer, _) = setup_active(&context, &lender)?;

    let amount = offer.get_current_debt() - 1;

    partial_repay_offer(&context, &mut offer, borrower, amount)?;

    assert_eq!(offer.get_current_debt(), 1);
    assert_eq!(offer_collateral(&context, &offer)?, 1);

    Ok(())
}

#[simplex::test]
fn wide_partial_repayments_then_full_repayment_succeed(
    context: simplex::TestContext,
) -> anyhow::Result<()> {
    let lender = context.random_signer();
    let borrower = context.get_default_signer();
    let (mut offer, _) = setup_active(&context, &lender)?;

    partial_repay_offer(&context, &mut offer, borrower, 10_000_000_000_000)?;
    partial_repay_offer(&context, &mut offer, borrower, 50_000_000_000_000)?;

    full_repay(&context, &mut offer)
}

#[simplex::test]
fn wide_partial_repayment_then_liquidation_succeed(
    context: simplex::TestContext,
) -> anyhow::Result<()> {
    let lender = context.random_signer();
    let borrower = context.get_default_signer();
    let (mut offer, _) = setup_active(&context, &lender)?;

    partial_repay_offer(&context, &mut offer, borrower, 50_000_000_000_000)?;

    liquidate(&context, &offer, &lender)
}

// The next two cases never exceed 2^64 on the current covenant: an active offer can only
// reach a `paid` value that a previous partial repayment already computed successfully.
#[simplex::test]
fn small_partial_then_full_repayment_on_large_offer_succeed(
    context: simplex::TestContext,
) -> anyhow::Result<()> {
    let lender = context.random_signer();
    let borrower = context.get_default_signer();
    let (mut offer, _) = setup_active(&context, &lender)?;

    partial_repay_offer(&context, &mut offer, borrower, 1_000_000_000_000)?;

    full_repay(&context, &mut offer)
}

#[simplex::test]
fn small_partial_then_liquidation_on_large_offer_succeed(
    context: simplex::TestContext,
) -> anyhow::Result<()> {
    let lender = context.random_signer();
    let borrower = context.get_default_signer();
    let (mut offer, _) = setup_active(&context, &lender)?;

    partial_repay_offer(&context, &mut offer, borrower, 1_000_000_000_000)?;

    liquidate(&context, &offer, &lender)
}

#[simplex::test]
fn high_interest_offer_can_be_accepted(context: simplex::TestContext) -> anyhow::Result<()> {
    let lender = context.random_signer();
    let (txid, mut offer, params) = setup_pending(
        &context,
        COLLATERAL,
        MAX_RATE_PRINCIPAL,
        MAX_RATE,
        MAX_RATE_PRINCIPAL,
    )?;

    fund_lender(
        &context,
        &lender,
        params.principal_asset_id,
        MAX_RATE_PRINCIPAL,
    )?;
    accept_pending_offer(&context, &mut offer, txid, &lender)?;

    assert_eq!(
        offer.get_current_debt(),
        params.offer_parameters.get_total_amount_to_repay()
    );

    Ok(())
}

#[simplex::test]
fn high_interest_offer_can_be_cancelled(context: simplex::TestContext) -> anyhow::Result<()> {
    let signer = context.get_default_signer();
    let (txid, offer, params) = setup_pending(
        &context,
        COLLATERAL,
        MAX_RATE_PRINCIPAL,
        MAX_RATE,
        MAX_RATE_PRINCIPAL,
    )?;

    let (offer_utxo, lender_nft) = get_pending_offer_utxos(&context, &offer, txid)?;
    let borrower_nft = signer.get_utxos_asset(params.borrower_nft_asset_id)?[0].clone();

    let mut ft = FinalTransaction::new();

    offer.attach_cancellation(&mut ft, offer_utxo, lender_nft);
    ft.add_input(
        PartialInput::new(borrower_nft),
        Some(NativeSignature::Ecdsa),
    );
    ft.add_output(PartialOutput::new(
        signer.get_address().script_pubkey(),
        COLLATERAL,
        params.collateral_asset_id,
    ));

    signer.broadcast(&ft)?.wait()?;

    Ok(())
}

// Every `mul_div_64` call site now takes the wide path: `before`, `after` and the validation.
#[simplex::test]
fn repeated_wide_partial_repayments_then_full_repayment_succeed(
    context: simplex::TestContext,
) -> anyhow::Result<()> {
    let lender = context.random_signer();
    let borrower = context.get_default_signer();
    let (mut offer, _) = setup_active(&context, &lender)?;

    partial_repay_offer(&context, &mut offer, borrower, 50_000_000_000_000)?;
    partial_repay_offer(&context, &mut offer, borrower, 20_000_000_000_000)?;
    partial_repay_offer(&context, &mut offer, borrower, 10_000_000_000_000)?;

    full_repay(&context, &mut offer)
}

// Both the interest and the collateral products are wide.
fn setup_active_with_max_rate(
    context: &simplex::TestContext,
    lender: &Signer,
) -> anyhow::Result<(LendingOffer, LendingOfferParameters)> {
    let (txid, mut offer, params) = setup_pending(
        context,
        COLLATERAL,
        MAX_RATE_PRINCIPAL,
        MAX_RATE,
        MAX_RATE_ISSUED_PRINCIPAL,
    )?;

    fund_lender(
        context,
        lender,
        params.principal_asset_id,
        MAX_RATE_PRINCIPAL,
    )?;
    accept_pending_offer(context, &mut offer, txid, lender)?;

    Ok((offer, params))
}

#[simplex::test]
fn max_rate_offer_partial_repayment_then_liquidation_succeed(
    context: simplex::TestContext,
) -> anyhow::Result<()> {
    let lender = context.random_signer();
    let borrower = context.get_default_signer();
    let (mut offer, _) = setup_active_with_max_rate(&context, &lender)?;

    partial_repay_offer(&context, &mut offer, borrower, 400_000_000_000_000)?;
    partial_repay_offer(&context, &mut offer, borrower, 100_000_000_000_000)?;

    liquidate(&context, &offer, &lender)
}
