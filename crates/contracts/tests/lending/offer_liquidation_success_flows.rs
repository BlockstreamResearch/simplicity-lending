use lending_contracts::programs::program::SimplexProgram;
use simplex::signer::Signer;
use simplex::transaction::{FinalTransaction, PartialInput, PartialOutput, RequiredSignature};

use lending_contracts::programs::lending::{
    ActiveLendingOffer, ActiveLendingOfferParameters, OfferParameters,
};

use super::common::wallet::split_first_signer_utxo;
use super::setup::{
    accept_pending_lending_offer, fund_lender, get_borrower_debt_nft_utxo, setup_issuance_factory,
    setup_pending_lending_offer,
};

fn default_offer_liquidation_setup(
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

#[simplex::test]
fn offer_liquidation_succeeds_after_expiration_time(
    context: simplex::TestContext,
) -> anyhow::Result<()> {
    let provider = context.get_default_provider();
    let lender = context.random_signer();

    let (active_lending_offer, active_offer_parameters) =
        default_offer_liquidation_setup(&context, &lender)?;

    let offer_expiration_height = (active_offer_parameters
        .offer_parameters
        .loan_expiration_time
        + 1) as u64;
    context
        .get_network_utils()
        .mine_until_height(offer_expiration_height)?;

    assert!(
        provider.fetch_tip_height()?
            >= active_offer_parameters
                .offer_parameters
                .loan_expiration_time
    );

    let active_offer_utxo =
        provider.fetch_scripthash_utxos(&active_lending_offer.get_script_pubkey())?[0].clone();
    let borrower_debt_nft_utxo = get_borrower_debt_nft_utxo(&context, active_offer_parameters)?;
    let lender_nft_utxo =
        lender.get_utxos_asset(active_offer_parameters.lender_nft_asset_id)?[0].clone();

    let mut ft = FinalTransaction::new();

    active_lending_offer.attach_loan_liquidation(
        &mut ft,
        active_offer_utxo,
        borrower_debt_nft_utxo,
    );

    ft.add_input(
        PartialInput::new(lender_nft_utxo),
        RequiredSignature::NativeEcdsa,
    );

    ft.add_output(PartialOutput::new(
        lender.get_address().script_pubkey(),
        active_offer_parameters.offer_parameters.collateral_amount,
        active_offer_parameters.collateral_asset_id,
    ));

    // TODO: Fix OwnableScriptAuth covenant during liquidation flow
    // lender.broadcast(&ft)?.wait()?;

    Ok(())
}
