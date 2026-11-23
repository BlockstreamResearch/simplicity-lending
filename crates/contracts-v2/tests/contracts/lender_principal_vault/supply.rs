use simplex::TestContext;

use crate::lender_principal_vault::fixture::{Fixture, Layout, State};
use crate::support::{chain, expect, tamper};

const SUPPLIED_AMOUNT: u64 = 100_000;
const SUPPLIED_FEE: u64 = 10_000;

const AMOUNT: u64 = 50_000;
const FEE: u64 = 5_000;

/// The position of the LendingOffer among the auth UTXOs of a supply.
const LENDING_OFFER: usize = 0;

/// A vault that was supplied to and is not finalized.
fn supplied() -> State {
    State::supplied(SUPPLIED_AMOUNT, SUPPLIED_FEE)
}

#[simplex::test]
fn supplies_to_vault(context: TestContext) -> anyhow::Result<()> {
    let mut fixture = Fixture::deploy(&context, supplied())?;

    for layout in [Layout::VaultFirst, Layout::VaultLast] {
        fixture.layout = layout;

        let balance = fixture.vault_utxo.explicit_amount();
        let expected = fixture
            .vault
            .get_storage()
            .with_supply(AMOUNT, FEE, false)?;

        fixture.apply(&context, fixture.supply(AMOUNT, FEE, false))?;

        assert_eq!(fixture.vault_utxo.explicit_amount(), balance + AMOUNT);
        assert_eq!(fixture.vault.get_storage(), expected);
    }

    Ok(())
}

#[simplex::test]
fn supplies_boundary_amounts(context: TestContext) -> anyhow::Result<()> {
    let mut fixture = Fixture::deploy(&context, supplied())?;

    // The least amount, without a fee and all of it being the fee
    for (amount, fee) in [(1, 0), (1, 1), (AMOUNT, AMOUNT)] {
        fixture.apply(&context, fixture.supply(amount, fee, false))?;
    }

    Ok(())
}

#[simplex::test]
fn finalizes_with_last_supply(context: TestContext) -> anyhow::Result<()> {
    let mut fixture = Fixture::deploy(&context, supplied())?;
    let lending_offer = fixture.lending_offer.explicit_asset();

    fixture.apply(&context, fixture.supply(AMOUNT, FEE, true))?;

    assert!(fixture.vault.get_storage().is_finalized);
    assert!(
        chain::signer_utxo(&context, lending_offer).is_err(),
        "the final supply burns the LendingOffer"
    );

    Ok(())
}

/// Nothing can be supplied once the vault is finalized.
#[simplex::test]
fn rejects_supply_to_finalized_vault(context: TestContext) -> anyhow::Result<()> {
    let fixture = Fixture::deploy(&context, supplied().finalized())?;

    let spend = fixture.supply(AMOUNT, FEE, false);

    expect::rejects(&context, &spend.tx, spend.vault_input);

    Ok(())
}

/// The supply is authorized by the LendingOffer the vault keeps in its state.
#[simplex::test]
fn rejects_lending_offer_input_with_another_asset(context: TestContext) -> anyhow::Result<()> {
    let fixture = Fixture::deploy(&context, supplied())?;

    let mut spend = fixture.supply(AMOUNT, FEE, false);
    let input = spend.auth_input(LENDING_OFFER);
    tamper::input_utxo(&mut spend.tx, input, fixture.lender_nft.clone());

    expect::rejects(&context, &spend.tx, spend.vault_input);

    Ok(())
}

/// The LendingOffer must stay in the transaction outputs.
#[simplex::test]
fn rejects_lending_offer_output_with_another_asset(context: TestContext) -> anyhow::Result<()> {
    let fixture = Fixture::deploy(&context, supplied())?;
    let other_asset = fixture.lender_nft.explicit_asset();

    let mut spend = fixture.supply(AMOUNT, FEE, false);
    let output = spend.auth_output(LENDING_OFFER);
    tamper::output(&mut spend.tx, output, |output| output.asset = other_asset);

    expect::rejects(&context, &spend.tx, spend.vault_input);

    Ok(())
}

/// The final supply burns the LendingOffer.
#[simplex::test]
fn rejects_final_supply_keeping_lending_offer(context: TestContext) -> anyhow::Result<()> {
    let fixture = Fixture::deploy(&context, supplied())?;
    let owner = chain::signer_script(&context);

    let mut spend = fixture.supply(AMOUNT, FEE, true);
    let output = spend.auth_output(LENDING_OFFER);
    tamper::output(&mut spend.tx, output, |output| output.script_pubkey = owner);

    expect::rejects(&context, &spend.tx, spend.vault_input);

    Ok(())
}

/// A supply that is not final keeps the LendingOffer.
#[simplex::test]
fn rejects_supply_burning_lending_offer(context: TestContext) -> anyhow::Result<()> {
    let fixture = Fixture::deploy(&context, supplied())?;

    let mut spend = fixture.supply(AMOUNT, FEE, false);
    let output = spend.auth_output(LENDING_OFFER);
    tamper::output(&mut spend.tx, output, |output| {
        output.script_pubkey = chain::burn_script();
    });

    expect::rejects(&context, &spend.tx, spend.vault_input);

    Ok(())
}

#[simplex::test]
fn rejects_zero_supply(context: TestContext) -> anyhow::Result<()> {
    let fixture = Fixture::deploy(&context, supplied())?;

    let spend = fixture.supply(0, 0, false);

    expect::rejects(&context, &spend.tx, spend.vault_input);

    Ok(())
}

/// The fee is a part of the supplied amount.
#[simplex::test]
fn rejects_fee_above_amount(context: TestContext) -> anyhow::Result<()> {
    let fixture = Fixture::deploy(&context, supplied())?;

    let spend = fixture.supply(AMOUNT, AMOUNT + 1, false);

    expect::rejects(&context, &spend.tx, spend.vault_input);

    Ok(())
}

/// The recreated vault is finalized exactly when the supply is final.
#[simplex::test]
fn rejects_successor_with_another_finalization(context: TestContext) -> anyhow::Result<()> {
    let fixture = Fixture::deploy(&context, supplied())?;
    let storage = fixture.vault.get_storage();

    for finalize in [false, true] {
        let flipped = fixture.vault_in(storage.with_supply(AMOUNT, FEE, !finalize)?);

        let mut spend = fixture.supply(AMOUNT, FEE, finalize);
        let output = spend.vault_output();
        tamper::output(&mut spend.tx, output, |output| {
            output.script_pubkey = flipped.get_script_pubkey();
        });

        expect::rejects(&context, &spend.tx, spend.vault_input);
    }

    Ok(())
}
