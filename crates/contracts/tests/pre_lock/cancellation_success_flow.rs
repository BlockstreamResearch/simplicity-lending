use lending_contracts::programs::program::SimplexProgram;
use lending_contracts::utils::LendingOfferParameters;
use simplex::simplicityhl::elements::OutPoint;
use simplex::transaction::{FinalTransaction, PartialOutput, UTXO};

use super::common::tx_steps::finalize_and_broadcast;
use super::setup::setup_pre_lock;

#[simplex::test]
fn cancels_pre_lock_successfully(context: simplex::TestContext) -> anyhow::Result<()> {
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

    let (pre_lock_creation_txid, pre_lock, pre_lock_parameters) =
        setup_pre_lock(&context, offer_parameters, principal_asset_amount)?;

    let pre_lock_utxo = provider.fetch_scripthash_utxos(&pre_lock.get_script_pubkey())?[0].clone();

    let pre_lock_creation_tx = provider.fetch_transaction(&pre_lock_creation_txid)?;

    let first_parameters_nft_utxo = UTXO {
        outpoint: OutPoint::new(pre_lock_creation_txid, 1),
        txout: pre_lock_creation_tx.output[1].clone(),
        secrets: None,
    };
    let second_parameters_nft_utxo = UTXO {
        outpoint: OutPoint::new(pre_lock_creation_txid, 2),
        txout: pre_lock_creation_tx.output[2].clone(),
        secrets: None,
    };
    let borrower_nft_utxo = UTXO {
        outpoint: OutPoint::new(pre_lock_creation_txid, 3),
        txout: pre_lock_creation_tx.output[3].clone(),
        secrets: None,
    };
    let lender_nft_utxo = UTXO {
        outpoint: OutPoint::new(pre_lock_creation_txid, 4),
        txout: pre_lock_creation_tx.output[4].clone(),
        secrets: None,
    };

    let mut ft = FinalTransaction::new();

    ft.add_output(PartialOutput::new(
        signer.get_address().script_pubkey(),
        pre_lock_parameters.offer_parameters.collateral_amount,
        pre_lock_parameters.collateral_asset_id,
    ));

    pre_lock.attach_cancellation(
        &mut ft,
        pre_lock_utxo,
        first_parameters_nft_utxo,
        second_parameters_nft_utxo,
        borrower_nft_utxo,
        lender_nft_utxo,
    );

    let txid = finalize_and_broadcast(&context, &ft)?;
    provider.wait(&txid)?;

    Ok(())
}
