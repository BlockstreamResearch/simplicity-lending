use lending_contracts::programs::lending::{PendingLendingOffer, PendingLendingOfferParameters};
use simplex::simplicityhl::elements::Txid;
use simplex::transaction::{FinalTransaction, PartialInput, PartialOutput, RequiredSignature};

use lending_contracts::programs::lending::OfferParameters;

use crate::lending_tests::setup::get_active_offer_utxos;

use super::common::wallet::split_first_signer_utxo;
use super::setup::{
    get_pending_offer_utxos, setup_active_lending_offer, setup_issuance_factory,
    setup_pending_lending_offer,
};

fn default_offer_cancellation_setup(
    context: &simplex::TestContext,
) -> anyhow::Result<(Txid, PendingLendingOffer, PendingLendingOfferParameters)> {
    let provider = context.get_default_provider();

    split_first_signer_utxo(&context, vec![5000, 10000]);

    let issuance_factory = setup_issuance_factory(&context)?;

    let principal_asset_amount = 20000;
    let current_height = provider.fetch_tip_height()?;

    let offer_parameters = OfferParameters {
        collateral_amount: 3000,
        principal_amount: 10000,
        loan_expiration_time: current_height + 60,
        principal_interest_rate: 1000,
    };

    setup_pending_lending_offer(
        &context,
        offer_parameters,
        issuance_factory,
        principal_asset_amount,
    )
}

#[simplex::test]
fn offer_cancellation_fails_when_offer_is_not_pending(
    context: simplex::TestContext,
) -> anyhow::Result<()> {
    let provider = context.get_default_provider();
    let borrower = context.get_default_signer();

    split_first_signer_utxo(&context, vec![5000, 10000]);

    let issuance_factory = setup_issuance_factory(&context)?;

    let principal_asset_amount = 20000;
    let current_height = provider.fetch_tip_height()?;

    let offer_parameters = OfferParameters {
        collateral_amount: 3000,
        principal_amount: 10000,
        loan_expiration_time: current_height + 60,
        principal_interest_rate: 1000,
    };

    let (active_offer_creation_txid, active_lending_offer, active_offer_parameters) =
        setup_active_lending_offer(
            &context,
            offer_parameters,
            issuance_factory,
            principal_asset_amount,
        )?;

    let (active_offer_utxo, borrower_debt_nft_utxo, lender_nft_utxo) =
        get_active_offer_utxos(&context, &active_lending_offer, active_offer_creation_txid)?;

    let pending_lending_offer = PendingLendingOffer::from_active_lending(active_offer_parameters);

    let mut ft = FinalTransaction::new();

    pending_lending_offer.attach_offer_cancellation(
        &mut ft,
        active_offer_utxo,
        borrower_debt_nft_utxo,
        lender_nft_utxo,
    );

    ft.add_output(PartialOutput::new(
        borrower.get_address().script_pubkey(),
        active_offer_parameters.offer_parameters.collateral_amount,
        active_offer_parameters.collateral_asset_id,
    ));

    let result = borrower.finalize(&ft);

    assert!(
        result.is_err(),
        "expected finalize to fail, but it succeeded"
    );

    Ok(())
}

#[simplex::test]
fn offer_cancellation_fails_when_pending_offer_utxo_is_not_0_input_index(
    context: simplex::TestContext,
) -> anyhow::Result<()> {
    let borrower = context.get_default_signer();

    let (pending_offer_creation_txid, pending_lending_offer, pending_offer_parameters) =
        default_offer_cancellation_setup(&context)?;

    let (pending_offer_utxo, borrower_debt_nft_utxo, lender_nft_utxo) = get_pending_offer_utxos(
        &context,
        &pending_lending_offer,
        pending_offer_creation_txid,
    )?;

    let borrower_utxo = borrower.get_utxos_asset(context.get_network().policy_asset())?[0].clone();
    let utxo_asset_amount = borrower_utxo.explicit_amount();

    let mut ft = FinalTransaction::new();

    ft.add_input(
        PartialInput::new(borrower_utxo),
        RequiredSignature::NativeEcdsa,
    );

    pending_lending_offer.attach_offer_cancellation(
        &mut ft,
        pending_offer_utxo,
        borrower_debt_nft_utxo,
        lender_nft_utxo,
    );

    ft.add_output(PartialOutput::new(
        borrower.get_address().script_pubkey(),
        pending_offer_parameters.offer_parameters.collateral_amount,
        pending_offer_parameters.collateral_asset_id,
    ));
    ft.add_output(PartialOutput::new(
        borrower.get_address().script_pubkey(),
        utxo_asset_amount,
        context.get_network().policy_asset(),
    ));

    let result = borrower.finalize(&ft);

    assert!(
        result.is_err(),
        "expected finalize to fail, but it succeeded"
    );

    Ok(())
}

#[simplex::test]
fn offer_cancellation_fails_when_collateral_utxo_is_on_0_output_index(
    context: simplex::TestContext,
) -> anyhow::Result<()> {
    let borrower = context.get_default_signer();

    let (pending_offer_creation_txid, pending_lending_offer, pending_offer_parameters) =
        default_offer_cancellation_setup(&context)?;

    let (pending_offer_utxo, borrower_debt_nft_utxo, lender_nft_utxo) = get_pending_offer_utxos(
        &context,
        &pending_lending_offer,
        pending_offer_creation_txid,
    )?;

    let mut ft = FinalTransaction::new();

    ft.add_output(PartialOutput::new(
        borrower.get_address().script_pubkey(),
        pending_offer_parameters.offer_parameters.collateral_amount,
        pending_offer_parameters.collateral_asset_id,
    ));

    pending_lending_offer.attach_offer_cancellation(
        &mut ft,
        pending_offer_utxo,
        borrower_debt_nft_utxo,
        lender_nft_utxo,
    );

    let result = borrower.finalize(&ft);

    assert!(
        result.is_err(),
        "expected finalize to fail, but it succeeded"
    );

    Ok(())
}
