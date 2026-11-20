use lending_contracts::programs::asset_auth_vault::AssetAuthVault;
use lending_contracts::programs::lending::{
    LendingOffer, LendingOfferParameters, OfferParameters, OfferRepaymentPhase,
};
use lending_contracts::programs::program::SimplexProgram;
use simplex::signer::Signer;
use simplex::transaction::{FinalTransaction, NativeSignature, PartialInput, PartialOutput};

use super::common::wallet::split_first_signer_utxo;
use super::setup::{
    accept_pending_offer, fund_lender, get_active_offer_vaults_utxos, partial_repay_offer,
    setup_issuance_factory, setup_pending_offer,
};

fn active_offer_setup(
    context: &simplex::TestContext,
    lender: &Signer,
    protocol_fee_rate: u16,
) -> anyhow::Result<(LendingOffer, LendingOfferParameters)> {
    let provider = context.get_default_provider();

    split_first_signer_utxo(context, vec![5000, 10000]);

    let issuance_factory = setup_issuance_factory(context)?;
    let current_height = provider.fetch_tip_height()?;

    let offer_parameters = OfferParameters {
        collateral_amount: 3000,
        principal_amount: 10000,
        loan_expiration_time: current_height + 60,
        principal_interest_rate: 1000,
        protocol_fee_rate,
    };

    let (pending_offer_creation_txid, mut offer, offer_parameters) =
        setup_pending_offer(context, offer_parameters, issuance_factory, 200000)?;

    fund_lender(
        context,
        lender,
        offer_parameters.principal_asset_id,
        offer_parameters.offer_parameters.principal_amount,
    )?;

    accept_pending_offer(context, &mut offer, pending_offer_creation_txid, lender)?;

    Ok((offer, offer_parameters))
}

fn full_repay_offer(
    context: &simplex::TestContext,
    offer: &mut LendingOffer,
    borrower: &Signer,
) -> anyhow::Result<()> {
    let provider = context.get_default_provider();
    let params = *offer.get_parameters();

    let active_offer_utxo = provider.fetch_scripthash_utxos(&offer.get_script_pubkey())?[0].clone();
    let remaining_collateral = active_offer_utxo.explicit_amount();
    let borrower_nft_utxo = borrower.get_utxos_asset(params.borrower_nft_asset_id)?[0].clone();
    let (lender_vault_utxo, protocol_fee_vault_utxo) =
        get_active_offer_vaults_utxos(context, offer)?;

    let borrower_principal_utxo = borrower
        .get_utxos_asset(params.principal_asset_id)?
        .into_iter()
        .max_by_key(|utxo| utxo.explicit_amount())
        .expect("Borrower has no principal UTXOs");
    let principal_utxo_amount = borrower_principal_utxo.explicit_amount();
    let current_debt = offer.get_current_debt();

    assert!(principal_utxo_amount >= current_debt);

    let mut ft = FinalTransaction::new();

    ft.add_input(
        PartialInput::new(borrower_nft_utxo),
        Some(NativeSignature::Ecdsa),
    );

    offer.attach_full_repayment(
        &mut ft,
        active_offer_utxo,
        lender_vault_utxo,
        protocol_fee_vault_utxo,
    );

    ft.add_input(
        PartialInput::new(borrower_principal_utxo),
        Some(NativeSignature::Ecdsa),
    );

    ft.add_output(PartialOutput::new(
        borrower.get_address().script_pubkey(),
        remaining_collateral,
        params.collateral_asset_id,
    ));

    if principal_utxo_amount > current_debt {
        ft.add_output(PartialOutput::new(
            borrower.get_address().script_pubkey(),
            principal_utxo_amount - current_debt,
            params.principal_asset_id,
        ));
    }

    borrower.broadcast(&ft)?.wait()?;

    Ok(())
}

fn vault_utxo_amounts(
    context: &simplex::TestContext,
    vault: &AssetAuthVault,
) -> anyhow::Result<Vec<u64>> {
    let provider = context.get_default_provider();

    Ok(provider
        .fetch_scripthash_utxos(&vault.get_script_pubkey())?
        .iter()
        .map(|utxo| utxo.explicit_amount())
        .collect())
}

/// With a zero supply goal the protocol fee vault can only ever be in its finalized state, so this
/// is the only script a zero-fee offer could have locked funds under.
fn protocol_fee_vault_utxo_count(
    context: &simplex::TestContext,
    params: &LendingOfferParameters,
) -> anyhow::Result<usize> {
    let vault_parameters = params.get_protocol_fee_vault_parameters();

    vault_utxo_amounts(context, &AssetAuthVault::new_finalized(vault_parameters))
        .map(|amounts| amounts.len())
}

#[simplex::test]
fn zero_protocol_fee_offer_is_repaid_without_protocol_fee_vault(
    context: simplex::TestContext,
) -> anyhow::Result<()> {
    let borrower = context.get_default_signer();
    let lender = context.random_signer();

    let (mut offer, offer_parameters) = active_offer_setup(&context, &lender, 0)?;
    let terms = offer_parameters.offer_parameters;
    let total_amount_to_repay = terms.get_total_amount_to_repay();

    assert_eq!(terms.get_total_protocol_fee(), 0);

    // Two installments while the interest is still being repaid: the second one used to require
    // a protocol fee vault input that a zero-fee offer never has.
    partial_repay_offer(&context, &mut offer, borrower, 500)?;

    assert_eq!(
        vault_utxo_amounts(&context, &offer.get_lender_vault())?,
        vec![500]
    );
    assert_eq!(
        protocol_fee_vault_utxo_count(&context, &offer_parameters)?,
        0
    );

    partial_repay_offer(&context, &mut offer, borrower, 300)?;

    assert_eq!(
        terms.get_repayment_phase(offer.get_current_debt()),
        OfferRepaymentPhase::RepayingOfferFee
    );
    assert_eq!(
        vault_utxo_amounts(&context, &offer.get_lender_vault())?,
        vec![800]
    );
    assert_eq!(
        protocol_fee_vault_utxo_count(&context, &offer_parameters)?,
        0
    );

    full_repay_offer(&context, &mut offer, borrower)?;

    let finalized_lender_vault =
        AssetAuthVault::new_finalized(offer_parameters.get_lender_vault_parameters());

    assert_eq!(
        vault_utxo_amounts(&context, &finalized_lender_vault)?,
        vec![total_amount_to_repay]
    );
    assert_eq!(
        protocol_fee_vault_utxo_count(&context, &offer_parameters)?,
        0
    );

    Ok(())
}

#[simplex::test]
fn protocol_fee_vault_is_created_by_first_repayment_with_protocol_share(
    context: simplex::TestContext,
) -> anyhow::Result<()> {
    let borrower = context.get_default_signer();
    let lender = context.random_signer();

    let (mut offer, offer_parameters) = active_offer_setup(&context, &lender, 1_000)?;
    let protocol_fee_vault_parameters = offer_parameters.get_protocol_fee_vault_parameters();

    // floor(5 * 10%) = 0: nothing for the protocol, so no protocol fee vault yet.
    partial_repay_offer(&context, &mut offer, borrower, 5)?;

    assert!(!offer.has_protocol_fee_vault());
    assert_eq!(
        vault_utxo_amounts(&context, &offer.get_lender_vault())?,
        vec![5]
    );
    assert_eq!(
        vault_utxo_amounts(
            &context,
            &AssetAuthVault::new_active(protocol_fee_vault_parameters, 0)
        )?,
        Vec::<u64>::new()
    );

    // floor(10 * 10%) - floor(5 * 10%) = 1: this repayment creates the protocol fee vault.
    partial_repay_offer(&context, &mut offer, borrower, 5)?;

    assert!(offer.has_protocol_fee_vault());
    assert_eq!(
        vault_utxo_amounts(&context, &offer.get_lender_vault())?,
        vec![9]
    );
    assert_eq!(
        vault_utxo_amounts(&context, &offer.get_protocol_fee_vault())?,
        vec![1]
    );

    // floor(15 * 10%) - floor(10 * 10%) = 0: the existing protocol fee vault is left untouched.
    partial_repay_offer(&context, &mut offer, borrower, 5)?;

    assert_eq!(
        vault_utxo_amounts(&context, &offer.get_lender_vault())?,
        vec![14]
    );
    assert_eq!(
        vault_utxo_amounts(&context, &offer.get_protocol_fee_vault())?,
        vec![1]
    );

    Ok(())
}
