use simplex::TestContext;
use simplex::transaction::{PartialInput, PartialOutput};

use crate::lender_principal_vault::fixture::{Fixture, Spend, State};
use crate::support::{chain, expect};

const AMOUNT: u64 = 50_000;
const FEE: u64 = 5_000;

/// A vault created with its first supply in it.
fn first_supply() -> State {
    State::supplied(AMOUNT, FEE)
}

/// Broadcasts the spend `step` builds, which recreates the vault, and checks the recreated vault
/// holds the lender's share and the protocol fee, nothing more or less.
fn advance(
    context: &TestContext,
    fixture: &mut Fixture,
    step: impl FnOnce(&Fixture) -> Spend,
) -> anyhow::Result<()> {
    let spend = step(fixture);
    fixture.apply(context, spend)?;

    let accounted =
        fixture.vault.available_lender_shares()? + fixture.vault.available_protocol_fee()?;
    anyhow::ensure!(
        fixture.vault_utxo.explicit_amount() == accounted,
        "the vault holds {} while its accounting says {accounted}",
        fixture.vault_utxo.explicit_amount()
    );

    Ok(())
}

/// Half of what the lender can withdraw partially now.
fn half_of_max_partial(fixture: &Fixture) -> u64 {
    let max = fixture
        .vault
        .max_partial_withdrawal(fixture.vault_utxo.explicit_amount())
        .expect("the fixture keeps the vault accounting consistent")
        .expect("the lender can withdraw partially");

    max / 2
}

/// A vault supplied to in parts, with the lender withdrawing in between, the offer repaid, the
/// harvester taking the fee and the lender taking the rest.
#[simplex::test]
fn repaid_offer_closes_by_lender(context: TestContext) -> anyhow::Result<()> {
    let mut fixture = Fixture::deploy(&context, first_supply())?;

    advance(&context, &mut fixture, |vault| {
        vault.supply(AMOUNT, FEE, false)
    })?;
    advance(&context, &mut fixture, |vault| {
        vault.partial_withdrawal(half_of_max_partial(vault))
    })?;
    advance(&context, &mut fixture, |vault| {
        vault.supply(AMOUNT, FEE, true)
    })?;
    advance(&context, &mut fixture, Fixture::harvester_withdrawal)?;

    fixture.close(&context, fixture.full_withdrawal())
}

/// The same offer, the lender taking their share first and the harvester closing the vault.
#[simplex::test]
fn repaid_offer_closes_by_harvester(context: TestContext) -> anyhow::Result<()> {
    let mut fixture = Fixture::deploy(&context, first_supply())?;

    advance(&context, &mut fixture, |vault| {
        vault.supply(AMOUNT, FEE, false)
    })?;
    advance(&context, &mut fixture, |vault| {
        vault.partial_withdrawal(half_of_max_partial(vault))
    })?;
    advance(&context, &mut fixture, |vault| {
        vault.supply(AMOUNT, FEE, true)
    })?;
    advance(&context, &mut fixture, Fixture::full_withdrawal)?;

    fixture.close(&context, fixture.harvester_withdrawal())
}

/// A liquidated offer: the lender takes their share at once, the vault takes no other lender
/// spend, and the harvester closes it.
#[simplex::test]
fn liquidated_offer_closes_by_harvester(context: TestContext) -> anyhow::Result<()> {
    let mut fixture = Fixture::deploy(&context, first_supply())?;

    advance(&context, &mut fixture, |vault| {
        vault.supply(AMOUNT, FEE, false)
    })?;
    advance(&context, &mut fixture, |vault| {
        vault.partial_withdrawal(half_of_max_partial(vault))
    })?;
    advance(&context, &mut fixture, Fixture::liquidation_withdrawal)?;

    // The LendingOffer and the LenderNFT are burned, so these spend the UTXOs they were in: the
    // vault rejects before anyone checks the UTXOs exist
    for spend in [
        fixture.supply(AMOUNT, FEE, false),
        fixture.partial_withdrawal(1),
        fixture.full_withdrawal(),
        fixture.liquidation_withdrawal(),
    ] {
        expect::rejects(&context, &spend.tx, spend.vault_input);
    }

    fixture.close(&context, fixture.harvester_withdrawal())
}

/// Two UTXOs at the vault script with the same balance can be spent together into one recreated
/// vault, as each checks only that output. The spender then takes back only what the other UTXO
/// held, and the vault holds what it would hold alone.
#[simplex::test]
fn merges_duplicate_vault_returning_only_its_balance(context: TestContext) -> anyhow::Result<()> {
    let mut fixture = Fixture::deploy(&context, State::supplied(100_000, 10_000))?;
    let balance = fixture.vault_utxo.explicit_amount();
    let duplicate = fixture.duplicate(&context)?;

    let mut spend = fixture.supply(AMOUNT, FEE, false);
    let next = spend.next.take().expect("a supply recreates the vault");

    // The duplicate runs the same program with the same witness, pointing at the same output
    let program_input = spend.tx.inputs()[spend.vault_input]
        .program_input
        .clone()
        .expect("the vault input runs the vault");
    spend
        .tx
        .add_program_input(PartialInput::new(duplicate), program_input, None);
    spend.tx.add_output(PartialOutput::new(
        chain::signer_script(&context),
        balance,
        fixture.principal.explicit_asset(),
    ));

    expect::accepts(&context, &spend.tx)?;

    let provider = context.get_default_provider();
    anyhow::ensure!(
        provider
            .fetch_scripthash_utxos(&fixture.vault.get_script_pubkey())?
            .is_empty(),
        "both UTXOs at the vault script are spent"
    );

    let recreated = provider.fetch_scripthash_utxos(&next.get_script_pubkey())?;
    anyhow::ensure!(
        recreated.len() == 1 && recreated[0].explicit_amount() == balance + AMOUNT,
        "one vault holds the supply on top of the balance of one UTXO"
    );

    Ok(())
}
