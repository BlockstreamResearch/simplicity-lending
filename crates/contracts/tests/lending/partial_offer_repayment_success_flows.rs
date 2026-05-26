use lending_contracts::programs::program::SimplexProgram;
use simplex::signer::Signer;
use simplex::transaction::{FinalTransaction, PartialInput, PartialOutput, RequiredSignature};

use lending_contracts::programs::lending::{
    LendingOffer, LendingOfferParameters, OfferParameters, OfferRepaymentPhase,
};

use super::common::wallet::split_first_signer_utxo;
use super::setup::{
    accept_pending_offer, fund_lender, get_active_offer_vaults_utxos, get_lender_vault_utxo,
    get_protocol_fee_vault_utxo, partial_repay_offer, setup_issuance_factory, setup_pending_offer,
};

fn default_partial_repayment_setup(
    context: &simplex::TestContext,
    lender: &Signer,
) -> anyhow::Result<(LendingOffer, LendingOfferParameters)> {
    let provider = context.get_default_provider();

    split_first_signer_utxo(context, vec![5000, 10000]);

    let issuance_factory = setup_issuance_factory(context)?;

    let principal_asset_amount = 200000;
    let current_height = provider.fetch_tip_height()?;

    let offer_parameters = OfferParameters {
        collateral_amount: 3000,
        principal_amount: 10000,
        loan_expiration_time: current_height + 60,
        principal_interest_rate: 1000,
    };

    let (pending_offer_creation_txid, mut offer, offer_parameters) = setup_pending_offer(
        context,
        offer_parameters,
        issuance_factory,
        principal_asset_amount,
    )?;

    fund_lender(
        context,
        lender,
        offer_parameters.principal_asset_id,
        offer_parameters.offer_parameters.principal_amount,
    )?;

    accept_pending_offer(context, &mut offer, pending_offer_creation_txid, lender)?;

    Ok((offer, offer_parameters))
}

fn check_vault_balances(
    context: &simplex::TestContext,
    offer: &LendingOffer,
    expected_lender_vault_amount: u64,
    expected_protocol_fee_vault_amount: u64,
) -> anyhow::Result<()> {
    let lender_vault_utxo = get_lender_vault_utxo(context, offer)?;
    let protocol_fee_vault_utxo = get_protocol_fee_vault_utxo(context, offer)?;

    assert_eq!(
        lender_vault_utxo.explicit_amount(),
        expected_lender_vault_amount
    );
    assert_eq!(
        protocol_fee_vault_utxo.explicit_amount(),
        expected_protocol_fee_vault_amount
    );

    Ok(())
}

#[simplex::test]
fn partial_repayment_succeeds_in_no_repayments_phase_with_amount_less_than_the_total_fee_amount(
    context: simplex::TestContext,
) -> anyhow::Result<()> {
    let provider = context.get_default_provider();
    let borrower = context.get_default_signer();
    let lender = context.random_signer();

    let (mut offer, offer_parameters) = default_partial_repayment_setup(&context, &lender)?;

    let active_offer_utxo = provider.fetch_scripthash_utxos(&offer.get_script_pubkey())?[0].clone();
    let borrower_nft_utxo =
        borrower.get_utxos_asset(offer_parameters.borrower_nft_asset_id)?[0].clone();

    let borrower_principal_utxo =
        borrower.get_utxos_asset(offer_parameters.principal_asset_id)?[0].clone();

    let principal_utxo_amount = borrower_principal_utxo.explicit_amount();
    let total_amount_to_repay = offer_parameters
        .offer_parameters
        .get_total_amount_to_repay();
    let total_fee_to_repay = offer_parameters.offer_parameters.get_total_fee();
    let amount_to_repay = total_fee_to_repay / 2;

    assert!(principal_utxo_amount >= amount_to_repay);
    assert_eq!(
        offer_parameters
            .offer_parameters
            .get_repayment_phase(total_amount_to_repay),
        OfferRepaymentPhase::NoRepayments
    );

    let mut ft = FinalTransaction::new();

    ft.add_input(
        PartialInput::new(borrower_nft_utxo),
        RequiredSignature::NativeEcdsa,
    );
    ft.add_output(PartialOutput::new(
        borrower.get_address().script_pubkey(),
        1,
        offer_parameters.borrower_nft_asset_id,
    ));

    offer.attach_partial_repayment(&mut ft, active_offer_utxo, None, None, amount_to_repay);

    ft.add_input(
        PartialInput::new(borrower_principal_utxo),
        RequiredSignature::NativeEcdsa,
    );

    if principal_utxo_amount > amount_to_repay {
        ft.add_output(PartialOutput::new(
            borrower.get_address().script_pubkey(),
            principal_utxo_amount - amount_to_repay,
            offer_parameters.principal_asset_id,
        ));
    }

    borrower.broadcast(&ft)?.wait()?;

    let protocol_fee_repaid = offer_parameters
        .offer_parameters
        .get_repaid_protocol_fee(total_amount_to_repay, amount_to_repay);

    check_vault_balances(
        &context,
        &offer,
        amount_to_repay - protocol_fee_repaid,
        protocol_fee_repaid,
    )?;

    Ok(())
}

#[simplex::test]
fn partial_repayment_succeeds_in_no_repayments_phase_with_amount_bigger_than_the_total_fee_amount(
    context: simplex::TestContext,
) -> anyhow::Result<()> {
    let provider = context.get_default_provider();
    let borrower = context.get_default_signer();
    let lender = context.random_signer();

    let (mut offer, offer_parameters) = default_partial_repayment_setup(&context, &lender)?;

    let active_offer_utxo = provider.fetch_scripthash_utxos(&offer.get_script_pubkey())?[0].clone();
    let borrower_nft_utxo =
        borrower.get_utxos_asset(offer_parameters.borrower_nft_asset_id)?[0].clone();

    let borrower_principal_utxo =
        borrower.get_utxos_asset(offer_parameters.principal_asset_id)?[0].clone();

    let principal_utxo_amount = borrower_principal_utxo.explicit_amount();
    let total_amount_to_repay = offer_parameters
        .offer_parameters
        .get_total_amount_to_repay();
    let total_fee_to_repay = offer_parameters.offer_parameters.get_total_fee();
    let amount_to_repay = total_fee_to_repay * 2;

    assert!(principal_utxo_amount >= amount_to_repay);
    assert_eq!(
        offer_parameters
            .offer_parameters
            .get_repayment_phase(total_amount_to_repay),
        OfferRepaymentPhase::NoRepayments
    );

    let mut ft = FinalTransaction::new();

    ft.add_input(
        PartialInput::new(borrower_nft_utxo),
        RequiredSignature::NativeEcdsa,
    );
    ft.add_output(PartialOutput::new(
        borrower.get_address().script_pubkey(),
        1,
        offer_parameters.borrower_nft_asset_id,
    ));

    offer.attach_partial_repayment(&mut ft, active_offer_utxo, None, None, amount_to_repay);

    ft.add_input(
        PartialInput::new(borrower_principal_utxo),
        RequiredSignature::NativeEcdsa,
    );

    if principal_utxo_amount > amount_to_repay {
        ft.add_output(PartialOutput::new(
            borrower.get_address().script_pubkey(),
            principal_utxo_amount - amount_to_repay,
            offer_parameters.principal_asset_id,
        ));
    }

    borrower.broadcast(&ft)?.wait()?;

    let total_protocol_fee = offer_parameters.offer_parameters.get_total_protocol_fee();

    check_vault_balances(
        &context,
        &offer,
        amount_to_repay - total_protocol_fee,
        total_protocol_fee,
    )?;

    Ok(())
}

#[simplex::test]
fn partial_repayment_succeeds_in_repayment_offer_fee_phase_with_amount_less_than_the_total_fee_amount(
    context: simplex::TestContext,
) -> anyhow::Result<()> {
    let provider = context.get_default_provider();
    let borrower = context.get_default_signer();
    let lender = context.random_signer();

    let (mut offer, offer_parameters) = default_partial_repayment_setup(&context, &lender)?;

    let total_fee_to_repay = offer_parameters.offer_parameters.get_total_fee();
    let amount_to_repay = total_fee_to_repay / 2;

    partial_repay_offer(&context, &mut offer, borrower, amount_to_repay)?;

    assert_eq!(
        offer_parameters
            .offer_parameters
            .get_repayment_phase(offer.get_current_debt()),
        OfferRepaymentPhase::RepayingOfferFee
    );

    let fee_amount_left = total_fee_to_repay - amount_to_repay;
    let amount_to_repay = fee_amount_left / 2;

    let active_offer_utxo = provider.fetch_scripthash_utxos(&offer.get_script_pubkey())?[0].clone();
    let borrower_nft_utxo =
        borrower.get_utxos_asset(offer_parameters.borrower_nft_asset_id)?[0].clone();
    let (lender_vault_utxo, protocol_fee_vault_utxo) =
        get_active_offer_vaults_utxos(&context, offer_parameters)?;

    let borrower_principal_utxo =
        borrower.get_utxos_asset(offer_parameters.principal_asset_id)?[0].clone();

    let principal_utxo_amount = borrower_principal_utxo.explicit_amount();

    assert!(principal_utxo_amount >= amount_to_repay);
    assert!(lender_vault_utxo.is_some());
    assert!(protocol_fee_vault_utxo.is_some());

    let mut ft = FinalTransaction::new();

    ft.add_input(
        PartialInput::new(borrower_nft_utxo),
        RequiredSignature::NativeEcdsa,
    );
    ft.add_output(PartialOutput::new(
        borrower.get_address().script_pubkey(),
        1,
        offer_parameters.borrower_nft_asset_id,
    ));

    offer.attach_partial_repayment(
        &mut ft,
        active_offer_utxo,
        lender_vault_utxo,
        protocol_fee_vault_utxo,
        amount_to_repay,
    );

    ft.add_input(
        PartialInput::new(borrower_principal_utxo),
        RequiredSignature::NativeEcdsa,
    );

    if principal_utxo_amount > amount_to_repay {
        ft.add_output(PartialOutput::new(
            borrower.get_address().script_pubkey(),
            principal_utxo_amount - amount_to_repay,
            offer_parameters.principal_asset_id,
        ));
    }

    borrower.broadcast(&ft)?.wait()?;

    let already_repaid_amount = offer_parameters
        .offer_parameters
        .get_already_repaid_amount(offer.get_current_debt());
    let already_repaid_protocol_fee = offer_parameters.offer_parameters.get_repaid_protocol_fee(
        offer_parameters
            .offer_parameters
            .get_total_amount_to_repay(),
        already_repaid_amount,
    );

    check_vault_balances(
        &context,
        &offer,
        already_repaid_amount - already_repaid_protocol_fee,
        already_repaid_protocol_fee,
    )?;

    Ok(())
}

#[simplex::test]
fn partial_repayment_succeeds_in_principal_repayment_phase(
    context: simplex::TestContext,
) -> anyhow::Result<()> {
    let provider = context.get_default_provider();
    let borrower = context.get_default_signer();
    let lender = context.random_signer();

    let (mut offer, offer_parameters) = default_partial_repayment_setup(&context, &lender)?;

    let total_fee_to_repay = offer_parameters.offer_parameters.get_total_fee();
    let amount_to_repay = total_fee_to_repay * 2;

    partial_repay_offer(&context, &mut offer, borrower, amount_to_repay)?;

    assert_eq!(
        offer_parameters
            .offer_parameters
            .get_repayment_phase(offer.get_current_debt()),
        OfferRepaymentPhase::RepayingPrincipal
    );

    let amount_to_repay = offer.get_current_debt() / 2;

    let active_offer_utxo = provider.fetch_scripthash_utxos(&offer.get_script_pubkey())?[0].clone();
    let borrower_nft_utxo =
        borrower.get_utxos_asset(offer_parameters.borrower_nft_asset_id)?[0].clone();
    let (lender_vault_utxo, protocol_fee_vault_utxo) =
        get_active_offer_vaults_utxos(&context, offer_parameters)?;

    let borrower_principal_utxo =
        borrower.get_utxos_asset(offer_parameters.principal_asset_id)?[0].clone();

    let principal_utxo_amount = borrower_principal_utxo.explicit_amount();

    assert!(principal_utxo_amount >= amount_to_repay);
    assert!(lender_vault_utxo.is_some());
    assert!(protocol_fee_vault_utxo.is_none());

    let mut ft = FinalTransaction::new();

    ft.add_input(
        PartialInput::new(borrower_nft_utxo),
        RequiredSignature::NativeEcdsa,
    );
    ft.add_output(PartialOutput::new(
        borrower.get_address().script_pubkey(),
        1,
        offer_parameters.borrower_nft_asset_id,
    ));

    offer.attach_partial_repayment(
        &mut ft,
        active_offer_utxo,
        lender_vault_utxo,
        protocol_fee_vault_utxo,
        amount_to_repay,
    );

    ft.add_input(
        PartialInput::new(borrower_principal_utxo),
        RequiredSignature::NativeEcdsa,
    );

    if principal_utxo_amount > amount_to_repay {
        ft.add_output(PartialOutput::new(
            borrower.get_address().script_pubkey(),
            principal_utxo_amount - amount_to_repay,
            offer_parameters.principal_asset_id,
        ));
    }

    borrower.broadcast(&ft)?.wait()?;

    let already_repaid_amount = offer_parameters
        .offer_parameters
        .get_already_repaid_amount(offer.get_current_debt());
    let already_repaid_protocol_fee = offer_parameters.offer_parameters.get_total_protocol_fee();

    check_vault_balances(
        &context,
        &offer,
        already_repaid_amount - already_repaid_protocol_fee,
        already_repaid_protocol_fee,
    )?;

    Ok(())
}
