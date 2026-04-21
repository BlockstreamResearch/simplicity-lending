use lending_contracts::programs::program::SimplexProgram;
use lending_contracts::utils::LendingOfferParameters;
use simplex::simplicityhl::elements::OutPoint;
use simplex::transaction::{
    FinalTransaction, PartialInput, PartialOutput, RequiredSignature, UTXO,
};

use super::common::tx_steps::finalize_and_broadcast;
use super::setup::{mine_until_height, setup_lending};

#[simplex::test]
fn liquidates_expired_loan(context: simplex::TestContext) -> anyhow::Result<()> {
    let provider = context.get_default_provider();
    let signer = context.get_default_signer();

    let principal_asset_amount = 15000;
    let current_height = provider.fetch_tip_height()?;

    let offer_parameters = LendingOfferParameters {
        collateral_amount: 3000,
        principal_amount: 10000,
        loan_expiration_time: current_height + 15,
        principal_interest_rate: 1000,
    };

    let (lending_creation_txid, lending, lending_parameters) =
        setup_lending(&context, offer_parameters, principal_asset_amount)?;

    mine_until_height(
        &context,
        lending_parameters.offer_parameters.loan_expiration_time + 1,
    )?;

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

    lending.attach_loan_liquidation(
        &mut ft,
        lending_utxo,
        first_parameters_nft_utxo,
        second_parameters_nft_utxo,
    );

    let lender_nft_utxo =
        signer.get_utxos_asset(lending_parameters.lender_nft_asset_id)?[0].clone();

    ft.add_input(
        PartialInput::new(lender_nft_utxo),
        RequiredSignature::NativeEcdsa,
    );

    let txid = finalize_and_broadcast(&context, &ft)?;

    provider.wait(&txid)?;

    Ok(())
}
