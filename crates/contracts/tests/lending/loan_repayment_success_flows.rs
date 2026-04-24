use lending_contracts::programs::program::SimplexProgram;
use lending_contracts::utils::LendingOfferParameters;
use simplex::simplicityhl::elements::OutPoint;
use simplex::transaction::{
    FinalTransaction, PartialInput, PartialOutput, RequiredSignature, UTXO,
};

use super::common::tx_steps::finalize_and_broadcast;
use super::common::wallet::get_split_utxo_ft;
use super::setup::setup_lending;

#[simplex::test]
fn repays_loan_with_single_principal_input(context: simplex::TestContext) -> anyhow::Result<()> {
    let provider = context.get_default_provider();
    let signer = context.get_default_signer();

    let principal_asset_amount = 20000;
    let current_height = provider.fetch_tip_height()?;

    let offer_parameters = LendingOfferParameters {
        collateral_amount: 3000,
        principal_amount: 10000,
        loan_expiration_time: current_height + 60,
        principal_interest_rate: 1000,
    };

    let (lending_creation_txid, lending, lending_parameters) =
        setup_lending(&context, offer_parameters, principal_asset_amount)?;

    let lending_utxo = provider.fetch_scripthash_utxos(&lending.get_script_pubkey())?[0].clone();

    let lending_creation_tx = provider.fetch_transaction(&lending_creation_txid)?;

    let first_parameters_nft_utxo = UTXO {
        outpoint: OutPoint::new(lending_creation_txid, 1),
        txout: lending_creation_tx.output[1].clone(),
        secrets: None,
    };
    let second_parameters_nft_utxo = UTXO {
        outpoint: OutPoint::new(lending_creation_txid, 2),
        txout: lending_creation_tx.output[2].clone(),
        secrets: None,
    };

    let mut ft = FinalTransaction::new();

    ft.add_output(PartialOutput::new(
        signer.get_address().script_pubkey(),
        lending_parameters.offer_parameters.collateral_amount,
        lending_parameters.collateral_asset_id,
    ));

    lending.attach_loan_repayment(
        &mut ft,
        lending_utxo,
        first_parameters_nft_utxo,
        second_parameters_nft_utxo,
    );

    let borrower_nft_utxo =
        signer.get_utxos_asset(lending_parameters.borrower_nft_asset_id)?[0].clone();
    let principal_utxo = signer.get_utxos_asset(lending_parameters.principal_asset_id)?[0].clone();

    ft.add_input(
        PartialInput::new(borrower_nft_utxo),
        RequiredSignature::NativeEcdsa,
    );
    ft.add_input(
        PartialInput::new(principal_utxo),
        RequiredSignature::NativeEcdsa,
    );

    let principal_with_interest = lending_parameters
        .offer_parameters
        .calculate_principal_with_interest();

    ft.add_output(PartialOutput::new(
        signer.get_address().script_pubkey(),
        principal_asset_amount - principal_with_interest,
        lending_parameters.principal_asset_id,
    ));

    let txid = finalize_and_broadcast(&context, &ft)?;

    provider.wait(&txid)?;

    Ok(())
}

#[simplex::test]
fn repays_loan_with_multiple_principal_inputs(context: simplex::TestContext) -> anyhow::Result<()> {
    let provider = context.get_default_provider();
    let signer = context.get_default_signer();

    let principal_asset_amount = 15000;
    let current_height = provider.fetch_tip_height()?;

    let offer_parameters = LendingOfferParameters {
        collateral_amount: 3000,
        principal_amount: 10000,
        loan_expiration_time: current_height + 60,
        principal_interest_rate: 1000,
    };

    let (lending_creation_txid, lending, lending_parameters) =
        setup_lending(&context, offer_parameters, principal_asset_amount)?;

    let principal_utxo = signer.get_utxos_asset(lending_parameters.principal_asset_id)?[0].clone();

    let ft = get_split_utxo_ft(
        principal_utxo,
        vec![5000, 5000, 5000],
        signer,
        *provider.get_network(),
    );

    let txid = finalize_and_broadcast(&context, &ft)?;
    provider.wait(&txid)?;

    let lending_utxo = provider.fetch_scripthash_utxos(&lending.get_script_pubkey())?[0].clone();

    let lending_creation_tx = provider.fetch_transaction(&lending_creation_txid)?;

    let first_parameters_nft_utxo = UTXO {
        outpoint: OutPoint::new(lending_creation_txid, 1),
        txout: lending_creation_tx.output[1].clone(),
        secrets: None,
    };
    let second_parameters_nft_utxo = UTXO {
        outpoint: OutPoint::new(lending_creation_txid, 2),
        txout: lending_creation_tx.output[2].clone(),
        secrets: None,
    };

    let mut ft = FinalTransaction::new();

    ft.add_output(PartialOutput::new(
        signer.get_address().script_pubkey(),
        lending_parameters.offer_parameters.collateral_amount,
        lending_parameters.collateral_asset_id,
    ));

    lending.attach_loan_repayment(
        &mut ft,
        lending_utxo,
        first_parameters_nft_utxo,
        second_parameters_nft_utxo,
    );

    let borrower_nft_utxo =
        signer.get_utxos_asset(lending_parameters.borrower_nft_asset_id)?[0].clone();
    let principal_utxos = signer.get_utxos_asset(lending_parameters.principal_asset_id)?;

    ft.add_input(
        PartialInput::new(borrower_nft_utxo),
        RequiredSignature::NativeEcdsa,
    );

    for principal_utxo in principal_utxos {
        ft.add_input(
            PartialInput::new(principal_utxo),
            RequiredSignature::NativeEcdsa,
        );
    }

    let principal_with_interest = lending_parameters
        .offer_parameters
        .calculate_principal_with_interest();

    ft.add_output(PartialOutput::new(
        signer.get_address().script_pubkey(),
        principal_asset_amount - principal_with_interest,
        lending_parameters.principal_asset_id,
    ));

    let txid = finalize_and_broadcast(&context, &ft)?;

    provider.wait(&txid)?;

    Ok(())
}

#[simplex::test]
fn repays_loan_with_confidential_principal_input_and_confidential_change(
    context: simplex::TestContext,
) -> anyhow::Result<()> {
    let provider = context.get_default_provider();
    let signer = context.get_default_signer();

    let principal_asset_amount = 15000;
    let current_height = provider.fetch_tip_height()?;

    let offer_parameters = LendingOfferParameters {
        collateral_amount: 3000,
        principal_amount: 10000,
        loan_expiration_time: current_height + 60,
        principal_interest_rate: 1000,
    };

    let (lending_creation_txid, lending, lending_parameters) =
        setup_lending(&context, offer_parameters, principal_asset_amount)?;

    let principal_utxo = signer.get_utxos_asset(lending_parameters.principal_asset_id)?[0].clone();

    let mut ft = FinalTransaction::new();

    ft.add_input(
        PartialInput::new(principal_utxo),
        RequiredSignature::NativeEcdsa,
    );
    ft.add_output(
        PartialOutput::new(
            signer.get_address().script_pubkey(),
            principal_asset_amount,
            lending_parameters.principal_asset_id,
        )
        .with_blinding_key(signer.get_blinding_public_key()),
    );

    let txid = finalize_and_broadcast(&context, &ft)?;
    provider.wait(&txid)?;

    let lending_utxo = provider.fetch_scripthash_utxos(&lending.get_script_pubkey())?[0].clone();

    let lending_creation_tx = provider.fetch_transaction(&lending_creation_txid)?;

    let first_parameters_nft_utxo = UTXO {
        outpoint: OutPoint::new(lending_creation_txid, 1),
        txout: lending_creation_tx.output[1].clone(),
        secrets: None,
    };
    let second_parameters_nft_utxo = UTXO {
        outpoint: OutPoint::new(lending_creation_txid, 2),
        txout: lending_creation_tx.output[2].clone(),
        secrets: None,
    };

    let mut ft = FinalTransaction::new();

    ft.add_output(PartialOutput::new(
        signer.get_address().script_pubkey(),
        lending_parameters.offer_parameters.collateral_amount,
        lending_parameters.collateral_asset_id,
    ));

    lending.attach_loan_repayment(
        &mut ft,
        lending_utxo,
        first_parameters_nft_utxo,
        second_parameters_nft_utxo,
    );

    let borrower_nft_utxo =
        signer.get_utxos_asset(lending_parameters.borrower_nft_asset_id)?[0].clone();
    let principal_utxo = signer.get_utxos_asset(lending_parameters.principal_asset_id)?[0].clone();

    assert!(
        principal_utxo.secrets.is_some(),
        "Not a confidential principal UTXO"
    );

    ft.add_input(
        PartialInput::new(borrower_nft_utxo),
        RequiredSignature::NativeEcdsa,
    );
    ft.add_input(
        PartialInput::new(principal_utxo),
        RequiredSignature::NativeEcdsa,
    );

    let principal_with_interest = lending_parameters
        .offer_parameters
        .calculate_principal_with_interest();

    ft.add_output(
        PartialOutput::new(
            signer.get_address().script_pubkey(),
            principal_asset_amount - principal_with_interest,
            lending_parameters.principal_asset_id,
        )
        .with_blinding_key(signer.get_blinding_public_key()),
    );

    let txid = finalize_and_broadcast(&context, &ft)?;

    provider.wait(&txid)?;

    Ok(())
}
