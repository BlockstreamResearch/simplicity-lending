use simplex::signer::Signer;
use simplex::transaction::{FinalTransaction, PartialInput, PartialOutput, RequiredSignature};

use lending_contracts::programs::lending::{
    ActiveLendingOffer, ActiveLendingOfferParameters, OfferParameters,
};

use super::common::wallet::split_first_signer_utxo;
use super::setup::{
    fund_lender, get_pending_offer_utxos, make_confidential, setup_issuance_factory,
    setup_pending_lending_offer,
};

fn default_offer_acceptance_setup(
    context: &simplex::TestContext,
    lender: &Signer,
) -> anyhow::Result<(
    FinalTransaction,
    ActiveLendingOffer,
    ActiveLendingOfferParameters,
)> {
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

    let (pending_offer_utxo, borrower_debt_nft_utxo, lender_nft_utxo) =
        get_pending_offer_utxos(context, &pending_lending_offer, pending_offer_creation_txid)?;

    let mut ft = FinalTransaction::new();

    let active_lending_offer = pending_lending_offer.attach_offer_acceptance(
        &mut ft,
        pending_offer_utxo,
        borrower_debt_nft_utxo,
        lender_nft_utxo,
    );
    let active_offer_parameters = *active_lending_offer.get_parameters();

    Ok((ft, active_lending_offer, active_offer_parameters))
}

#[simplex::test]
fn accepts_pending_offer_with_one_explicit_principal_input(
    context: simplex::TestContext,
) -> anyhow::Result<()> {
    let lender = context.random_signer();

    let (mut ft, _, active_offer_parameters) = default_offer_acceptance_setup(&context, &lender)?;

    let lender_principal_utxo = lender.get_utxos_filter(
        &|utxo| {
            utxo.explicit_asset() == active_offer_parameters.principal_asset_id
                && utxo.explicit_amount()
                    >= active_offer_parameters.offer_parameters.principal_amount
        },
        &|_| true,
    )?[0]
        .clone();

    let principal_utxo_amount = lender_principal_utxo.explicit_amount();

    ft.add_input(
        PartialInput::new(lender_principal_utxo),
        RequiredSignature::NativeEcdsa,
    );

    ft.add_output(PartialOutput::new(
        lender.get_address().script_pubkey(),
        1,
        active_offer_parameters.lender_nft_asset_id,
    ));

    if principal_utxo_amount > active_offer_parameters.offer_parameters.principal_amount {
        ft.add_output(PartialOutput::new(
            lender.get_address().script_pubkey(),
            principal_utxo_amount - active_offer_parameters.offer_parameters.principal_amount,
            active_offer_parameters.principal_asset_id,
        ));
    }

    lender.broadcast(&ft)?.wait()?;

    Ok(())
}

#[simplex::test]
fn accepts_pending_offer_with_one_confidential_principal_input(
    context: simplex::TestContext,
) -> anyhow::Result<()> {
    let lender = context.random_signer();

    let (mut ft, _, active_offer_parameters) = default_offer_acceptance_setup(&context, &lender)?;

    let lender_principal_utxo = lender.get_utxos_filter(
        &|utxo| {
            utxo.explicit_asset() == active_offer_parameters.principal_asset_id
                && utxo.explicit_amount()
                    >= active_offer_parameters.offer_parameters.principal_amount
        },
        &|_| true,
    )?[0]
        .clone();

    make_confidential(&lender, lender_principal_utxo)?;

    let conf_principal_utxo =
        lender.get_utxos_asset(active_offer_parameters.principal_asset_id)?[0].clone();

    let principal_utxo_amount = conf_principal_utxo.unblinded_amount();

    ft.add_input(
        PartialInput::new(conf_principal_utxo),
        RequiredSignature::NativeEcdsa,
    );

    ft.add_output(PartialOutput::new(
        lender.get_address().script_pubkey(),
        1,
        active_offer_parameters.lender_nft_asset_id,
    ));

    if principal_utxo_amount > active_offer_parameters.offer_parameters.principal_amount {
        ft.add_output(
            PartialOutput::new(
                lender.get_address().script_pubkey(),
                principal_utxo_amount - active_offer_parameters.offer_parameters.principal_amount,
                active_offer_parameters.principal_asset_id,
            )
            .with_blinding_key(lender.get_blinding_public_key()),
        );
    }

    lender.broadcast(&ft)?.wait()?;

    Ok(())
}
