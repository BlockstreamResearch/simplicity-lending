use simplex::transaction::{FinalTransaction, PartialInput, PartialOutput, RequiredSignature};

use lending_contracts::programs::lending::{LendingOfferParameters, OfferParameters};

use super::common::wallet::split_first_signer_utxo;
use super::setup::{get_pending_offer_utxos, setup_issuance_factory, setup_pending_offer};

fn default_offer_cancellation_setup(
    context: &simplex::TestContext,
) -> anyhow::Result<(FinalTransaction, LendingOfferParameters)> {
    let provider = context.get_default_provider();
    let signer = context.get_default_signer();

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

    let (pending_offer_creation_txid, pending_offer, offer_parameters) = setup_pending_offer(
        context,
        offer_parameters,
        issuance_factory,
        principal_asset_amount,
    )?;

    let (pending_offer_utxo, lender_nft_utxo) =
        get_pending_offer_utxos(context, &pending_offer, pending_offer_creation_txid)?;
    let borrower_nft = signer.get_utxos_asset(offer_parameters.borrower_nft_asset_id)?[0].clone();

    let mut ft = FinalTransaction::new();

    pending_offer.attach_cancellation(&mut ft, pending_offer_utxo, lender_nft_utxo);

    ft.add_input(
        PartialInput::new(borrower_nft),
        RequiredSignature::NativeEcdsa,
    );

    Ok((ft, offer_parameters))
}

#[simplex::test]
fn cancels_pending_offer_with_one_explicit_collateral_output(
    context: simplex::TestContext,
) -> anyhow::Result<()> {
    let signer = context.get_default_signer();

    let (mut ft, offer_parameters) = default_offer_cancellation_setup(&context)?;

    ft.add_output(PartialOutput::new(
        signer.get_address().script_pubkey(),
        offer_parameters.offer_parameters.collateral_amount,
        offer_parameters.collateral_asset_id,
    ));

    signer.broadcast(&ft)?.wait()?;

    Ok(())
}

#[simplex::test]
fn cancels_pending_offer_with_several_explicit_collateral_outputs(
    context: simplex::TestContext,
) -> anyhow::Result<()> {
    let signer = context.get_default_signer();

    let (mut ft, offer_parameters) = default_offer_cancellation_setup(&context)?;

    ft.add_output(PartialOutput::new(
        signer.get_address().script_pubkey(),
        offer_parameters.offer_parameters.collateral_amount / 2,
        offer_parameters.collateral_asset_id,
    ));

    ft.add_output(PartialOutput::new(
        signer.get_address().script_pubkey(),
        offer_parameters.offer_parameters.collateral_amount / 2,
        offer_parameters.collateral_asset_id,
    ));

    signer.broadcast(&ft)?.wait()?;

    Ok(())
}

#[simplex::test]
fn cancels_pending_offer_with_one_confidential_collateral_output(
    context: simplex::TestContext,
) -> anyhow::Result<()> {
    let signer = context.get_default_signer();

    let (mut ft, offer_parameters) = default_offer_cancellation_setup(&context)?;

    ft.add_output(
        PartialOutput::new(
            signer.get_confidential_address().script_pubkey(),
            offer_parameters.offer_parameters.collateral_amount,
            offer_parameters.collateral_asset_id,
        )
        .with_blinding_key(signer.get_blinding_public_key()),
    );

    signer.broadcast(&ft)?.wait()?;

    Ok(())
}
