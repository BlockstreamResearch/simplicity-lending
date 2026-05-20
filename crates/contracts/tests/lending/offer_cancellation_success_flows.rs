use simplex::transaction::{FinalTransaction, PartialOutput};

use lending_contracts::programs::lending::{OfferParameters, PendingLendingOfferParameters};

use super::common::wallet::split_first_signer_utxo;
use super::setup::{get_pending_offer_utxos, setup_issuance_factory, setup_pending_lending_offer};

fn default_offer_cancellation_setup(
    context: &simplex::TestContext,
) -> anyhow::Result<(FinalTransaction, PendingLendingOfferParameters)> {
    let provider = context.get_default_provider();

    split_first_signer_utxo(context, vec![5000, 10000]);

    let issuance_factory = setup_issuance_factory(context)?;

    let principal_asset_amount = 20000;
    let current_height = provider.fetch_tip_height()?;

    let offer_parameters = OfferParameters {
        collateral_amount: 3000,
        principal_amount: 10000,
        loan_expiration_time: current_height + 60,
        principal_interest_rate: 1000,
    };

    let (pending_offer_creation_txid, pending_lending_offer, pending_offer_parameters) =
        setup_pending_lending_offer(
            context,
            offer_parameters,
            issuance_factory,
            principal_asset_amount,
        )?;

    let (pending_offer_utxo, borrower_debt_nft_utxo, lender_nft_utxo) =
        get_pending_offer_utxos(context, &pending_lending_offer, pending_offer_creation_txid)?;

    let mut ft = FinalTransaction::new();

    pending_lending_offer.attach_offer_cancellation(
        &mut ft,
        pending_offer_utxo,
        borrower_debt_nft_utxo,
        lender_nft_utxo,
    );

    Ok((ft, pending_offer_parameters))
}

#[simplex::test]
fn cancels_pending_offer_with_one_explicit_collateral_output(
    context: simplex::TestContext,
) -> anyhow::Result<()> {
    let signer = context.get_default_signer();

    let (mut ft, pending_offer_parameters) = default_offer_cancellation_setup(&context)?;

    ft.add_output(PartialOutput::new(
        signer.get_address().script_pubkey(),
        pending_offer_parameters.offer_parameters.collateral_amount,
        pending_offer_parameters.collateral_asset_id,
    ));

    signer.broadcast(&ft)?.wait()?;

    Ok(())
}

#[simplex::test]
fn cancels_pending_offer_with_several_explicit_collateral_outputs(
    context: simplex::TestContext,
) -> anyhow::Result<()> {
    let signer = context.get_default_signer();

    let (mut ft, pending_offer_parameters) = default_offer_cancellation_setup(&context)?;

    ft.add_output(PartialOutput::new(
        signer.get_address().script_pubkey(),
        pending_offer_parameters.offer_parameters.collateral_amount / 2,
        pending_offer_parameters.collateral_asset_id,
    ));

    ft.add_output(PartialOutput::new(
        signer.get_address().script_pubkey(),
        pending_offer_parameters.offer_parameters.collateral_amount / 2,
        pending_offer_parameters.collateral_asset_id,
    ));

    signer.broadcast(&ft)?.wait()?;

    Ok(())
}

#[simplex::test]
fn cancels_pending_offer_with_one_confidential_collateral_output(
    context: simplex::TestContext,
) -> anyhow::Result<()> {
    let signer = context.get_default_signer();

    let (mut ft, pending_offer_parameters) = default_offer_cancellation_setup(&context)?;

    ft.add_output(
        PartialOutput::new(
            signer.get_confidential_address().script_pubkey(),
            pending_offer_parameters.offer_parameters.collateral_amount,
            pending_offer_parameters.collateral_asset_id,
        )
        .with_blinding_key(signer.get_blinding_public_key()),
    );

    signer.broadcast(&ft)?.wait()?;

    Ok(())
}
