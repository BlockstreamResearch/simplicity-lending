use simplex::TestContext;
use simplex::either::Either::{Left, Right};

use lending_contracts_v2::artifacts::contracts::vault::lender_principal_vault::LenderPrincipalVaultProgram;

use crate::lender_principal_vault::fixture::{Fixture, Layout, MIN_VAULT_BALANCE, Spend, State};
use crate::support::{chain, expect, tamper};

const AMOUNT: u64 = 10_000;

/// The position of the LenderNFT among the auth UTXOs of a partial withdrawal.
const LENDER_NFT: usize = 0;

/// A vault holding 100 000: the lender's share of 95 000 and 5 000 of protocol fee. The most the
/// lender can withdraw partially is bounded by the share.
fn bounded_by_shares() -> State {
    State::supplied(100_000, 50_000)
}

/// A vault holding 100 000 that are all the lender's share. The most the lender can withdraw
/// partially is bounded by the balance the vault keeps.
fn bounded_by_min_balance() -> State {
    State::supplied(100_000, 0)
}

/// The most the lender can withdraw partially from the vault of `fixture`.
fn max_partial_withdrawal(fixture: &Fixture) -> anyhow::Result<u64> {
    fixture
        .vault
        .max_partial_withdrawal(fixture.vault_utxo.explicit_amount())?
        .ok_or_else(|| anyhow::anyhow!("nothing can be withdrawn partially"))
}

/// The witness of `spend` claims to withdraw `amount`.
fn claim_amount(spend: &mut Spend, amount: u64) {
    tamper::witness::<LenderPrincipalVaultProgram>(&mut spend.tx, spend.vault_input, |witness| {
        let Right(Left(Left(params))) = &mut witness.path else {
            panic!("the witness takes another path");
        };

        params.3 = amount;
    });
}

#[simplex::test]
fn withdraws_part_of_lender_share(context: TestContext) -> anyhow::Result<()> {
    let mut fixture = Fixture::deploy(&context, bounded_by_shares())?;
    let lender_nft = fixture.lender_nft.explicit_asset();

    for layout in [Layout::VaultFirst, Layout::VaultLast] {
        fixture.layout = layout;

        let balance = fixture.vault_utxo.explicit_amount();
        let expected = fixture
            .vault
            .get_storage()
            .with_lender_withdrawal(AMOUNT, false)?;

        fixture.apply(&context, fixture.partial_withdrawal(AMOUNT))?;

        assert_eq!(fixture.vault_utxo.explicit_amount(), balance - AMOUNT);
        assert_eq!(fixture.vault.get_storage(), expected);
        assert!(
            chain::signer_utxo(&context, lender_nft).is_ok(),
            "the LenderNFT stays with the lender"
        );
    }

    Ok(())
}

#[simplex::test]
fn withdraws_single_unit(context: TestContext) -> anyhow::Result<()> {
    let mut fixture = Fixture::deploy(&context, bounded_by_shares())?;

    fixture.apply(&context, fixture.partial_withdrawal(1))
}

/// The lender can withdraw all of their share but one unit, which only a full withdrawal takes.
#[simplex::test]
fn withdraws_all_of_share_but_one(context: TestContext) -> anyhow::Result<()> {
    let mut fixture = Fixture::deploy(&context, bounded_by_shares())?;
    let shares = fixture.vault.available_lender_shares()?;

    let amount = max_partial_withdrawal(&fixture)?;
    assert_eq!(amount, shares - 1, "the share bounds the withdrawal");

    fixture.apply(&context, fixture.partial_withdrawal(amount))?;

    assert_eq!(fixture.vault.available_lender_shares()?, 1);

    Ok(())
}

/// The lender can withdraw until the vault keeps exactly its least balance.
#[simplex::test]
fn withdraws_down_to_min_balance(context: TestContext) -> anyhow::Result<()> {
    let mut fixture = Fixture::deploy(&context, bounded_by_min_balance())?;

    let amount = max_partial_withdrawal(&fixture)?;
    fixture.apply(&context, fixture.partial_withdrawal(amount))?;

    assert_eq!(fixture.vault_utxo.explicit_amount(), MIN_VAULT_BALANCE);

    Ok(())
}

/// Once the vault is finalized, the lender withdraws only all of their share at once.
#[simplex::test]
fn rejects_withdrawal_from_finalized_vault(context: TestContext) -> anyhow::Result<()> {
    let fixture = Fixture::deploy(&context, bounded_by_shares().finalized())?;

    let spend = fixture.partial_withdrawal(AMOUNT);

    expect::rejects(&context, &spend.tx, spend.vault_input);

    Ok(())
}

/// The withdrawal is authorized by the LenderNFT the vault keeps in its state.
#[simplex::test]
fn rejects_lender_nft_input_with_another_asset(context: TestContext) -> anyhow::Result<()> {
    let fixture = Fixture::deploy(&context, bounded_by_shares())?;

    let mut spend = fixture.partial_withdrawal(AMOUNT);
    let input = spend.auth_input(LENDER_NFT);
    tamper::input_utxo(&mut spend.tx, input, fixture.lending_offer.clone());

    expect::rejects(&context, &spend.tx, spend.vault_input);

    Ok(())
}

/// The LenderNFT must stay in the transaction outputs.
#[simplex::test]
fn rejects_lender_nft_output_with_another_asset(context: TestContext) -> anyhow::Result<()> {
    let fixture = Fixture::deploy(&context, bounded_by_shares())?;
    let other_asset = fixture.lending_offer.explicit_asset();

    let mut spend = fixture.partial_withdrawal(AMOUNT);
    let output = spend.auth_output(LENDER_NFT);
    tamper::output(&mut spend.tx, output, |output| output.asset = other_asset);

    expect::rejects(&context, &spend.tx, spend.vault_input);

    Ok(())
}

/// A partial withdrawal keeps the LenderNFT, which the lender needs for the rest of their share.
#[simplex::test]
fn rejects_withdrawal_burning_lender_nft(context: TestContext) -> anyhow::Result<()> {
    let fixture = Fixture::deploy(&context, bounded_by_shares())?;

    let mut spend = fixture.partial_withdrawal(AMOUNT);
    let output = spend.auth_output(LENDER_NFT);
    tamper::output(&mut spend.tx, output, |output| {
        output.script_pubkey = chain::burn_script();
    });

    expect::rejects(&context, &spend.tx, spend.vault_input);

    Ok(())
}

#[simplex::test]
fn rejects_zero_withdrawal(context: TestContext) -> anyhow::Result<()> {
    let fixture = Fixture::deploy(&context, bounded_by_shares())?;

    let spend = fixture.partial_withdrawal(0);

    expect::rejects(&context, &spend.tx, spend.vault_input);

    Ok(())
}

/// The whole share is taken only by a full withdrawal.
#[simplex::test]
fn rejects_withdrawal_of_whole_share(context: TestContext) -> anyhow::Result<()> {
    let fixture = Fixture::deploy(&context, bounded_by_shares())?;

    let spend = fixture.partial_withdrawal(fixture.vault.available_lender_shares()?);

    expect::rejects(&context, &spend.tx, spend.vault_input);

    Ok(())
}

/// The vault keeps at least its least balance after a partial withdrawal.
#[simplex::test]
fn rejects_withdrawal_below_min_balance(context: TestContext) -> anyhow::Result<()> {
    let fixture = Fixture::deploy(&context, bounded_by_min_balance())?;

    let spend = fixture.partial_withdrawal(max_partial_withdrawal(&fixture)? + 1);

    expect::rejects(&context, &spend.tx, spend.vault_input);

    Ok(())
}

/// A vault created with less than its accounting says cannot pay out more than it holds.
#[simplex::test]
fn rejects_withdrawal_above_balance(context: TestContext) -> anyhow::Result<()> {
    let balance = 5_000;
    let fixture = Fixture::deploy_mismatched(&context, bounded_by_min_balance(), balance)?;

    let mut spend = fixture.partial_withdrawal(AMOUNT / 10);
    claim_amount(&mut spend, balance + 1);

    expect::rejects(&context, &spend.tx, spend.vault_input);

    Ok(())
}

/// A partial withdrawal does not finalize the vault.
#[simplex::test]
fn rejects_finalized_successor(context: TestContext) -> anyhow::Result<()> {
    let fixture = Fixture::deploy(&context, bounded_by_shares())?;
    let finalized = fixture.vault_in(
        fixture
            .vault
            .get_storage()
            .with_lender_withdrawal(AMOUNT, true)?,
    );

    let mut spend = fixture.partial_withdrawal(AMOUNT);
    let output = spend.vault_output();
    tamper::output(&mut spend.tx, output, |output| {
        output.script_pubkey = finalized.get_script_pubkey();
    });

    expect::rejects(&context, &spend.tx, spend.vault_input);

    Ok(())
}
