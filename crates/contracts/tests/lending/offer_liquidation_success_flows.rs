use lending_contracts::programs::program::SimplexProgram;
use simplex::signer::Signer;
use simplex::transaction::{FinalTransaction, NativeSignature, PartialInput, PartialOutput};

use lending_contracts::programs::lending::{LendingOffer, LendingOfferParameters, OfferParameters};

use super::common::wallet::split_first_signer_utxo;
use super::setup::{
    accept_pending_offer, fund_lender, get_lender_vault_utxo, partial_repay_offer,
    setup_issuance_factory, setup_pending_offer,
};

pub(super) fn default_offer_liquidation_setup(
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

    let _ = accept_pending_offer(context, &mut offer, pending_offer_creation_txid, lender)?;

    Ok((offer, offer_parameters))
}

#[simplex::test]
fn offer_liquidation_succeeds_after_expiration_time(
    context: simplex::TestContext,
) -> anyhow::Result<()> {
    let provider = context.get_default_provider();
    let lender = context.random_signer();

    let (lending_offer, offer_parameters) = default_offer_liquidation_setup(&context, &lender)?;

    let offer_expiration_height =
        (offer_parameters.offer_parameters.loan_expiration_time + 1) as u64;
    context
        .get_network_utils()
        .mine_until_height(offer_expiration_height)?;

    assert!(provider.fetch_tip_height()? >= offer_parameters.offer_parameters.loan_expiration_time);

    let active_offer_utxo =
        provider.fetch_scripthash_utxos(&lending_offer.get_script_pubkey())?[0].clone();
    let lender_nft_utxo = lender.get_utxos_asset(offer_parameters.lender_nft_asset_id)?[0].clone();

    let mut ft = FinalTransaction::new();

    lending_offer.attach_liquidation(&mut ft, active_offer_utxo);

    ft.add_input(
        PartialInput::new(lender_nft_utxo),
        Some(NativeSignature::Ecdsa),
    );

    ft.add_output(PartialOutput::new(
        lender.get_address().script_pubkey(),
        offer_parameters.offer_parameters.collateral_amount,
        offer_parameters.collateral_asset_id,
    ));

    lender.broadcast(&ft)?.wait()?;

    Ok(())
}

#[simplex::test]
fn offer_liquidation_withdraws_lender_vault_after_partial_repayment(
    context: simplex::TestContext,
) -> anyhow::Result<()> {
    let provider = context.get_default_provider();
    let lender = context.random_signer();

    let (mut lending_offer, offer_parameters) = default_offer_liquidation_setup(&context, &lender)?;

    partial_repay_offer(
        &context,
        &mut lending_offer,
        context.get_default_signer(),
        3000,
    )?;

    let offer_expiration_height =
        (offer_parameters.offer_parameters.loan_expiration_time + 1) as u64;
    context
        .get_network_utils()
        .mine_until_height(offer_expiration_height)?;

    let active_offer_utxo =
        provider.fetch_scripthash_utxos(&lending_offer.get_script_pubkey())?[0].clone();
    let lender_nft_utxo = lender.get_utxos_asset(offer_parameters.lender_nft_asset_id)?[0].clone();
    let lender_vault_utxo = get_lender_vault_utxo(&context, &lending_offer)?;

    let collateral_amount = active_offer_utxo.explicit_amount();
    let lender_vault_amount = lender_vault_utxo.explicit_amount();
    assert!(lender_vault_amount > 0);

    let lender_principal_before: u64 = lender
        .get_utxos_asset(offer_parameters.principal_asset_id)?
        .iter()
        .map(|utxo| utxo.explicit_amount())
        .sum();

    let lender_vault = lending_offer.get_lender_vault();

    let mut ft = FinalTransaction::new();

    lending_offer.attach_liquidation(&mut ft, active_offer_utxo);

    ft.add_input(
        PartialInput::new(lender_nft_utxo),
        Some(NativeSignature::Ecdsa),
    );

    lender_vault.attach_withdrawing_on_liquidation(&mut ft, lender_vault_utxo, 1, 0);

    ft.add_output(PartialOutput::new(
        lender.get_address().script_pubkey(),
        collateral_amount,
        offer_parameters.collateral_asset_id,
    ));
    ft.add_output(PartialOutput::new(
        lender.get_address().script_pubkey(),
        lender_vault_amount,
        offer_parameters.principal_asset_id,
    ));

    lender.broadcast(&ft)?.wait()?;

    assert!(
        provider
            .fetch_scripthash_utxos(&lender_vault.get_script_pubkey())?
            .is_empty()
    );

    let lender_principal_after: u64 = lender
        .get_utxos_asset(offer_parameters.principal_asset_id)?
        .iter()
        .map(|utxo| utxo.explicit_amount())
        .sum();

    assert_eq!(
        lender_principal_after,
        lender_principal_before + lender_vault_amount
    );

    Ok(())
}
