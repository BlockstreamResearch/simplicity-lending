use lending_contracts::programs::lending::{LendingOffer, LendingOfferSpend, OfferParameters};
use lending_contracts::programs::program::SimplexProgram;
use lending_contracts::programs::script_auth::ScriptAuth;
use simplex::simplicityhl::elements::{Script, Transaction, Txid};
use simplex::transaction::{FinalTransaction, NativeSignature, PartialInput, PartialOutput};

use super::common::wallet::split_first_signer_utxo;
use super::offer_liquidation_success_flows::default_offer_liquidation_setup;
use super::setup::{
    accept_pending_offer, fund_lender, get_active_offer_vaults_utxos, get_pending_offer_utxos,
    setup_issuance_factory, setup_pending_offer,
};

const JUNK_AMOUNT: u64 = 1000;

fn pending_offer_setup(context: &simplex::TestContext) -> anyhow::Result<(Txid, LendingOffer)> {
    let provider = context.get_default_provider();

    split_first_signer_utxo(context, vec![5000, 10000]);

    let issuance_factory = setup_issuance_factory(context)?;
    let current_height = provider.fetch_tip_height()?;

    let offer_parameters = OfferParameters {
        collateral_amount: 3000,
        principal_amount: 10000,
        loan_expiration_time: current_height + 60,
        principal_interest_rate: 1000,
    };

    let (creation_txid, pending_offer, _) =
        setup_pending_offer(context, offer_parameters, issuance_factory, 20000)?;

    Ok((creation_txid, pending_offer))
}

fn fetch_tx(context: &simplex::TestContext, txid: &Txid) -> anyhow::Result<Transaction> {
    Ok(context.get_default_provider().fetch_transaction(txid)?)
}

fn junk_output(context: &simplex::TestContext, script_pubkey: Script) -> PartialOutput {
    PartialOutput::new(
        script_pubkey,
        JUNK_AMOUNT,
        context.get_network().policy_asset(),
    )
}

#[simplex::test]
fn classifies_broadcast_acceptance(context: simplex::TestContext) -> anyhow::Result<()> {
    let lender = context.random_signer();

    let (creation_txid, mut offer) = pending_offer_setup(&context)?;
    let pending_offer = LendingOffer::new_pending(*offer.get_parameters());
    let params = *offer.get_parameters();

    fund_lender(
        &context,
        &lender,
        params.principal_asset_id,
        params.offer_parameters.principal_amount,
    )?;
    let acceptance_txid = accept_pending_offer(&context, &mut offer, creation_txid, &lender)?;

    let spend = pending_offer.classify_spend(&fetch_tx(&context, &acceptance_txid)?, 0, None)?;

    let LendingOfferSpend::Acceptance(scan) = spend else {
        panic!("expected acceptance, got {spend:?}");
    };
    assert_eq!(scan.active_offer_vout, 0);
    assert_eq!(scan.borrower_principal_vout, 1);

    Ok(())
}

#[simplex::test]
fn classifies_broadcast_cancellation_with_junk_outputs(
    context: simplex::TestContext,
) -> anyhow::Result<()> {
    let signer = context.get_default_signer();

    let (creation_txid, pending_offer) = pending_offer_setup(&context)?;
    let params = *pending_offer.get_parameters();

    let (pending_offer_utxo, lender_nft_utxo) =
        get_pending_offer_utxos(&context, &pending_offer, creation_txid)?;
    let borrower_nft = signer.get_utxos_asset(params.borrower_nft_asset_id)?[0].clone();

    let mut ft = FinalTransaction::new();
    pending_offer.attach_cancellation(&mut ft, pending_offer_utxo, lender_nft_utxo);
    ft.add_input(
        PartialInput::new(borrower_nft),
        Some(NativeSignature::Ecdsa),
    );

    ft.add_output(junk_output(&context, Script::new_op_return(b"junk")));
    ft.add_output(junk_output(&context, pending_offer.get_script_pubkey()));
    ft.add_output(junk_output(
        &context,
        ScriptAuth::from_simplex_program(&pending_offer).get_script_pubkey(),
    ));
    ft.add_output(PartialOutput::new(
        signer.get_address().script_pubkey(),
        params.offer_parameters.collateral_amount,
        params.collateral_asset_id,
    ));

    let receipt = signer.broadcast(&ft)?;
    receipt.wait()?;

    let spend = pending_offer.classify_spend(&fetch_tx(&context, &receipt.txid())?, 0, None)?;

    assert!(
        matches!(spend, LendingOfferSpend::Cancellation(_)),
        "expected cancellation, got {spend:?}"
    );

    Ok(())
}

#[simplex::test]
fn classifies_broadcast_partial_repayment_with_junk_outputs(
    context: simplex::TestContext,
) -> anyhow::Result<()> {
    let provider = context.get_default_provider();
    let borrower = context.get_default_signer();
    let lender = context.random_signer();

    let (mut offer, params) = default_offer_liquidation_setup(&context, &lender)?;
    let debt_before = offer.get_current_debt();
    let active_offer = LendingOffer::new_active(params, debt_before);
    let amount_to_repay = 500;

    let active_offer_utxo = provider.fetch_scripthash_utxos(&offer.get_script_pubkey())?[0].clone();
    let borrower_nft_utxo = borrower.get_utxos_asset(params.borrower_nft_asset_id)?[0].clone();
    let (lender_vault_utxo, protocol_fee_vault_utxo) =
        get_active_offer_vaults_utxos(&context, &offer)?;
    let borrower_principal_utxo = borrower
        .get_utxos_asset(params.principal_asset_id)?
        .into_iter()
        .max_by_key(|utxo| utxo.explicit_amount())
        .expect("borrower has principal");
    let principal_utxo_amount = borrower_principal_utxo.explicit_amount();

    let mut ft = FinalTransaction::new();
    ft.add_input(
        PartialInput::new(borrower_nft_utxo),
        Some(NativeSignature::Ecdsa),
    );
    ft.add_output(PartialOutput::new(
        borrower.get_address().script_pubkey(),
        1,
        params.borrower_nft_asset_id,
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
        Some(NativeSignature::Ecdsa),
    );

    ft.add_output(junk_output(&context, Script::new_op_return(b"junk")));
    ft.add_output(junk_output(&context, offer.get_script_pubkey()));

    let terms = params.offer_parameters;
    let collateral_to_unlock = terms.get_already_unlocked_collateral(offer.get_current_debt())
        - terms.get_already_unlocked_collateral(debt_before);
    ft.add_output(PartialOutput::new(
        borrower.get_address().script_pubkey(),
        collateral_to_unlock,
        params.collateral_asset_id,
    ));
    ft.add_output(PartialOutput::new(
        borrower.get_address().script_pubkey(),
        principal_utxo_amount - amount_to_repay,
        params.principal_asset_id,
    ));

    let receipt = borrower.broadcast(&ft)?;
    receipt.wait()?;

    let spend = active_offer.classify_spend(&fetch_tx(&context, &receipt.txid())?, 1, None)?;

    let LendingOfferSpend::PartialRepayment(scan) = spend else {
        panic!("expected partial repayment, got {spend:?}");
    };
    assert_eq!(scan.amount_to_repay, amount_to_repay);
    assert_eq!(scan.debt_after, debt_before - amount_to_repay);
    assert_eq!(scan.continuing_offer_vout, Some(1));

    Ok(())
}
