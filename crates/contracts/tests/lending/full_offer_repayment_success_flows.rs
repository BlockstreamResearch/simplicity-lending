use lending_contracts::programs::program::SimplexProgram;
use simplex::signer::Signer;
use simplex::transaction::{FinalTransaction, PartialInput, PartialOutput, RequiredSignature};

use lending_contracts::programs::lending::{
    ActiveLendingOffer, ActiveLendingOfferParameters, OfferParameters, OfferRepaymentPhase,
};

use super::common::wallet::split_first_signer_utxo;
use super::setup::{
    accept_pending_lending_offer, fund_lender, get_borrower_debt_nft_utxo, get_offer_vaults_utxos,
    partial_repay_offer, setup_issuance_factory, setup_pending_lending_offer,
};

fn default_full_repayment_setup(
    context: &simplex::TestContext,
    lender: &Signer,
) -> anyhow::Result<(ActiveLendingOffer, ActiveLendingOfferParameters)> {
    let provider = context.get_default_provider();

    split_first_signer_utxo(&context, vec![5000, 10000]);

    let issuance_factory = setup_issuance_factory(&context)?;

    let principal_asset_amount = 200000;
    let current_height = provider.fetch_tip_height()?;

    let offer_parameters = OfferParameters {
        collateral_amount: 3000,
        principal_amount: 10000,
        loan_expiration_time: current_height + 60,
        principal_interest_rate: 1000,
    };

    let (pending_offer_creation_txid, pending_lending_offer, pending_offer_parameters) =
        setup_pending_lending_offer(
            &context,
            offer_parameters,
            issuance_factory,
            principal_asset_amount,
        )?;

    fund_lender(
        context,
        lender,
        pending_offer_parameters.principal_asset_id,
        pending_offer_parameters.offer_parameters.principal_amount,
    )?;

    let (_, active_lending_offer) = accept_pending_lending_offer(
        context,
        pending_lending_offer,
        pending_offer_creation_txid,
        lender,
    )?;

    let active_offer_parameters = *active_lending_offer.get_parameters();

    Ok((active_lending_offer, active_offer_parameters))
}

fn check_finalized_vaults(
    context: &simplex::TestContext,
    active_offer_parameters: ActiveLendingOfferParameters,
) -> anyhow::Result<()> {
    let provider = context.get_default_provider();

    let finalized_lender_vault_utxo = provider.fetch_scripthash_utxos(
        &active_offer_parameters
            .get_finalized_lender_vault()
            .get_script_pubkey(),
    )?[0]
        .clone();
    let finalized_protocol_fee_vault_utxo = provider.fetch_scripthash_utxos(
        &active_offer_parameters
            .get_finalized_protocol_fee_vault()
            .get_script_pubkey(),
    )?[0]
        .clone();

    let total_amount_to_repay = active_offer_parameters
        .offer_parameters
        .get_total_amount_to_repay();
    let total_protocol_fee = active_offer_parameters
        .offer_parameters
        .get_total_protocol_fee();

    assert_eq!(
        finalized_lender_vault_utxo.explicit_amount(),
        total_amount_to_repay - total_protocol_fee
    );
    assert_eq!(
        finalized_protocol_fee_vault_utxo.explicit_amount(),
        total_protocol_fee
    );

    Ok(())
}

#[simplex::test]
fn full_repayment_succeeds_in_no_repayments_phase(
    context: simplex::TestContext,
) -> anyhow::Result<()> {
    let provider = context.get_default_provider();
    let borrower = context.get_default_signer();
    let lender = context.random_signer();

    let (active_lending_offer, active_offer_parameters) =
        default_full_repayment_setup(&context, &lender)?;

    let active_offer_utxo =
        provider.fetch_scripthash_utxos(&active_lending_offer.get_script_pubkey())?[0].clone();
    let borrower_debt_nft_utxo = get_borrower_debt_nft_utxo(&context, active_offer_parameters)?;

    let borrower_principal_utxo =
        borrower.get_utxos_asset(active_offer_parameters.principal_asset_id)?[0].clone();

    let principal_utxo_amount = borrower_principal_utxo.explicit_amount();
    let total_amount_to_repay = active_offer_parameters
        .offer_parameters
        .get_total_amount_to_repay();

    assert!(principal_utxo_amount >= total_amount_to_repay);
    assert_eq!(
        active_offer_parameters
            .offer_parameters
            .get_repayment_phase(borrower_debt_nft_utxo.explicit_amount()),
        OfferRepaymentPhase::NoRepayments
    );

    let mut ft = FinalTransaction::new();

    active_lending_offer.attach_full_repayment(
        &mut ft,
        active_offer_utxo,
        borrower_debt_nft_utxo,
        None,
        None,
    );

    ft.add_input(
        PartialInput::new(borrower_principal_utxo),
        RequiredSignature::NativeEcdsa,
    );

    ft.add_output(PartialOutput::new(
        borrower.get_address().script_pubkey(),
        active_offer_parameters.offer_parameters.collateral_amount,
        active_offer_parameters.collateral_asset_id,
    ));

    if principal_utxo_amount > total_amount_to_repay {
        ft.add_output(PartialOutput::new(
            borrower.get_address().script_pubkey(),
            principal_utxo_amount - total_amount_to_repay,
            active_offer_parameters.principal_asset_id,
        ));
    }

    borrower.broadcast(&ft)?.wait()?;

    check_finalized_vaults(&context, active_offer_parameters)?;

    Ok(())
}

#[simplex::test]
fn full_repayment_succeeds_in_repaying_offer_fees_phase(
    context: simplex::TestContext,
) -> anyhow::Result<()> {
    let provider = context.get_default_provider();
    let borrower = context.get_default_signer();
    let lender = context.random_signer();

    let (active_lending_offer, active_offer_parameters) =
        default_full_repayment_setup(&context, &lender)?;

    let total_amount_to_repay = active_offer_parameters
        .offer_parameters
        .get_total_amount_to_repay();
    let total_fee_to_repay = active_offer_parameters.offer_parameters.get_total_fee();
    let amount_to_repay = total_fee_to_repay / 2;

    partial_repay_offer(&context, &active_lending_offer, borrower, amount_to_repay)?;

    let active_offer_utxo =
        provider.fetch_scripthash_utxos(&active_lending_offer.get_script_pubkey())?[0].clone();
    let borrower_debt_nft_utxo = get_borrower_debt_nft_utxo(&context, active_offer_parameters)?;
    let (lender_vault_utxo, protocol_fee_vault_utxo) =
        get_offer_vaults_utxos(&context, active_offer_parameters)?;

    let current_debt = borrower_debt_nft_utxo.explicit_amount();

    assert_eq!(total_amount_to_repay, current_debt + amount_to_repay);
    assert_eq!(
        active_offer_parameters
            .offer_parameters
            .get_repayment_phase(current_debt),
        OfferRepaymentPhase::RepayingOfferFee
    );
    assert!(lender_vault_utxo.is_some());
    assert!(protocol_fee_vault_utxo.is_some());

    let borrower_principal_utxo =
        borrower.get_utxos_asset(active_offer_parameters.principal_asset_id)?[0].clone();

    let principal_utxo_amount = borrower_principal_utxo.explicit_amount();

    assert!(principal_utxo_amount >= current_debt);

    let mut ft = FinalTransaction::new();

    active_lending_offer.attach_full_repayment(
        &mut ft,
        active_offer_utxo,
        borrower_debt_nft_utxo,
        lender_vault_utxo,
        protocol_fee_vault_utxo,
    );

    ft.add_input(
        PartialInput::new(borrower_principal_utxo),
        RequiredSignature::NativeEcdsa,
    );

    ft.add_output(PartialOutput::new(
        borrower.get_address().script_pubkey(),
        active_offer_parameters.offer_parameters.collateral_amount,
        active_offer_parameters.collateral_asset_id,
    ));

    if principal_utxo_amount > current_debt {
        ft.add_output(PartialOutput::new(
            borrower.get_address().script_pubkey(),
            principal_utxo_amount - current_debt,
            active_offer_parameters.principal_asset_id,
        ));
    }

    borrower.broadcast(&ft)?.wait()?;

    check_finalized_vaults(&context, active_offer_parameters)?;

    Ok(())
}

#[simplex::test]
fn full_repayment_succeeds_in_repaying_principal_phase(
    context: simplex::TestContext,
) -> anyhow::Result<()> {
    let provider = context.get_default_provider();
    let borrower = context.get_default_signer();
    let lender = context.random_signer();

    let (active_lending_offer, active_offer_parameters) =
        default_full_repayment_setup(&context, &lender)?;

    let total_amount_to_repay = active_offer_parameters
        .offer_parameters
        .get_total_amount_to_repay();
    let total_fee_to_repay = active_offer_parameters.offer_parameters.get_total_fee();
    let amount_to_repay = total_fee_to_repay * 2;

    partial_repay_offer(&context, &active_lending_offer, borrower, amount_to_repay)?;

    let active_offer_utxo =
        provider.fetch_scripthash_utxos(&active_lending_offer.get_script_pubkey())?[0].clone();
    let borrower_debt_nft_utxo = get_borrower_debt_nft_utxo(&context, active_offer_parameters)?;
    let (lender_vault_utxo, protocol_fee_vault_utxo) =
        get_offer_vaults_utxos(&context, active_offer_parameters)?;

    let current_debt = borrower_debt_nft_utxo.explicit_amount();

    assert_eq!(total_amount_to_repay, current_debt + amount_to_repay);
    assert_eq!(
        active_offer_parameters
            .offer_parameters
            .get_repayment_phase(current_debt),
        OfferRepaymentPhase::RepayingPrincipal
    );
    assert!(lender_vault_utxo.is_some());
    assert!(protocol_fee_vault_utxo.is_none());

    let borrower_principal_utxo =
        borrower.get_utxos_asset(active_offer_parameters.principal_asset_id)?[0].clone();

    let principal_utxo_amount = borrower_principal_utxo.explicit_amount();

    assert!(principal_utxo_amount >= current_debt);

    let mut ft = FinalTransaction::new();

    active_lending_offer.attach_full_repayment(
        &mut ft,
        active_offer_utxo,
        borrower_debt_nft_utxo,
        lender_vault_utxo,
        protocol_fee_vault_utxo,
    );

    ft.add_input(
        PartialInput::new(borrower_principal_utxo),
        RequiredSignature::NativeEcdsa,
    );

    ft.add_output(PartialOutput::new(
        borrower.get_address().script_pubkey(),
        active_offer_parameters.offer_parameters.collateral_amount,
        active_offer_parameters.collateral_asset_id,
    ));

    if principal_utxo_amount > current_debt {
        ft.add_output(PartialOutput::new(
            borrower.get_address().script_pubkey(),
            principal_utxo_amount - current_debt,
            active_offer_parameters.principal_asset_id,
        ));
    }

    borrower.broadcast(&ft)?.wait()?;

    check_finalized_vaults(&context, active_offer_parameters)?;

    Ok(())
}
