use lending_contracts::programs::program::SimplexProgram;
use lending_contracts::utils::LendingOfferParameters;
use simplex::simplicityhl::elements::{Address, AssetId, OutPoint};
use simplex::transaction::{
    FinalTransaction, PartialInput, PartialOutput, RequiredSignature, UTXO,
};

use super::common::tx_steps::finalize_and_broadcast;
use super::common::wallet::get_split_utxo_ft;
use super::setup::setup_pre_lock;

fn fund_bob_address(
    context: &simplex::TestContext,
    principal_asset_id: AssetId,
    principal_asset_amount: u64,
    bob_address: Address,
) -> anyhow::Result<()> {
    let provider = context.get_default_provider();
    let alice = context.get_default_signer();

    let txid = alice.send(bob_address.script_pubkey(), 500)?;
    provider.wait(&txid)?;

    let principal_utxo = alice.get_utxos_asset(principal_asset_id)?[0].clone();
    let utxo_amount = principal_utxo.explicit_amount();

    assert!(
        utxo_amount >= principal_asset_amount,
        "Not enough principal tokens"
    );

    let mut ft = FinalTransaction::new();

    ft.add_input(
        PartialInput::new(principal_utxo),
        RequiredSignature::NativeEcdsa,
    );

    ft.add_output(PartialOutput::new(
        bob_address.script_pubkey(),
        principal_asset_amount,
        principal_asset_id,
    ));

    if utxo_amount > principal_asset_amount {
        ft.add_output(PartialOutput::new(
            alice.get_address().script_pubkey(),
            utxo_amount - principal_asset_amount,
            principal_asset_id,
        ));
    }

    let txid = finalize_and_broadcast(context, &ft)?;
    provider.wait(&txid)?;

    Ok(())
}

#[simplex::test]
fn creates_lending_with_single_principal_input(
    context: simplex::TestContext,
) -> anyhow::Result<()> {
    let provider = context.get_default_provider();
    let alice = context.get_default_signer();
    let bob = context
        .create_signer("sing slogan bar group gauge sphere rescue fossil loyal vital model desert");

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

    fund_bob_address(
        &context,
        pre_lock_parameters.principal_asset_id,
        principal_asset_amount / 2,
        bob.get_address(),
    )?;

    let principal_utxo = bob.get_utxos_asset(pre_lock_parameters.principal_asset_id)?[0].clone();

    let mut ft = FinalTransaction::new();

    pre_lock.attach_lending_creation(
        &mut ft,
        pre_lock_utxo,
        first_parameters_nft_utxo,
        second_parameters_nft_utxo,
        borrower_nft_utxo,
        lender_nft_utxo,
    );

    ft.add_input(
        PartialInput::new(principal_utxo.clone()),
        RequiredSignature::NativeEcdsa,
    );

    ft.add_output(PartialOutput::new(
        alice.get_address().script_pubkey(),
        1,
        pre_lock_parameters.borrower_nft_asset_id,
    ));

    ft.add_output(PartialOutput::new(
        bob.get_address().script_pubkey(),
        1,
        pre_lock_parameters.lender_nft_asset_id,
    ));

    ft.add_output(PartialOutput::new(
        alice.get_address().script_pubkey(),
        pre_lock_parameters.offer_parameters.principal_amount,
        pre_lock_parameters.principal_asset_id,
    ));

    if principal_utxo.explicit_amount() > pre_lock_parameters.offer_parameters.principal_amount {
        ft.add_output(PartialOutput::new(
            bob.get_address().script_pubkey(),
            principal_utxo.explicit_amount()
                - pre_lock_parameters.offer_parameters.principal_amount,
            pre_lock_parameters.principal_asset_id,
        ));
    }

    let (tx, _) = bob.finalize(&ft).unwrap();
    let txid = provider.broadcast_transaction(&tx).unwrap();
    provider.wait(&txid)?;

    Ok(())
}

#[simplex::test]
fn creates_lending_with_multiple_principal_inputs(
    context: simplex::TestContext,
) -> anyhow::Result<()> {
    let provider = context.get_default_provider();
    let alice = context.get_default_signer();
    let bob = context
        .create_signer("sing slogan bar group gauge sphere rescue fossil loyal vital model desert");

    let principal_asset_amount = 20000;
    let current_height = provider.fetch_tip_height()?;

    let offer_parameters = LendingOfferParameters {
        collateral_amount: 3000,
        principal_amount: 7000,
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

    let bob_principal_amount = principal_asset_amount / 2;
    fund_bob_address(
        &context,
        pre_lock_parameters.principal_asset_id,
        bob_principal_amount,
        bob.get_address(),
    )?;

    let principal_utxo = bob.get_utxos_asset(pre_lock_parameters.principal_asset_id)?[0].clone();

    let ft = get_split_utxo_ft(
        principal_utxo,
        vec![5000, 3000, 2000],
        &bob,
        *provider.get_network(),
    );

    let (tx, _) = bob.finalize(&ft).unwrap();
    let txid = provider.broadcast_transaction(&tx).unwrap();
    provider.wait(&txid)?;

    let mut ft = FinalTransaction::new();

    pre_lock.attach_lending_creation(
        &mut ft,
        pre_lock_utxo,
        first_parameters_nft_utxo,
        second_parameters_nft_utxo,
        borrower_nft_utxo,
        lender_nft_utxo,
    );

    let principal_utxos = bob.get_utxos_asset(pre_lock_parameters.principal_asset_id)?;

    for principal_utxo in principal_utxos {
        ft.add_input(
            PartialInput::new(principal_utxo),
            RequiredSignature::NativeEcdsa,
        );
    }

    ft.add_output(PartialOutput::new(
        alice.get_address().script_pubkey(),
        1,
        pre_lock_parameters.borrower_nft_asset_id,
    ));

    ft.add_output(PartialOutput::new(
        bob.get_address().script_pubkey(),
        1,
        pre_lock_parameters.lender_nft_asset_id,
    ));

    ft.add_output(PartialOutput::new(
        alice.get_address().script_pubkey(),
        pre_lock_parameters.offer_parameters.principal_amount,
        pre_lock_parameters.principal_asset_id,
    ));

    if bob_principal_amount > pre_lock_parameters.offer_parameters.principal_amount {
        ft.add_output(PartialOutput::new(
            bob.get_address().script_pubkey(),
            bob_principal_amount - pre_lock_parameters.offer_parameters.principal_amount,
            pre_lock_parameters.principal_asset_id,
        ));
    }

    let (tx, _) = bob.finalize(&ft).unwrap();
    let txid = provider.broadcast_transaction(&tx).unwrap();
    provider.wait(&txid)?;

    Ok(())
}
