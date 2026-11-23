use simplex::TestContext;

use crate::lender_principal_vault::fixture::{Fixture, Layout, State};
use crate::support::{chain, expect, tamper};

/// The positions of the auth UTXOs of a liquidation withdrawal.
const LENDING_OFFER: usize = 0;
const LENDER_NFT: usize = 1;

/// A vault holding 100 000: the lender's share of 95 000 and 5 000 of protocol fee.
fn with_protocol_fee() -> State {
    State::supplied(100_000, 50_000)
}

/// A vault holding only the lender's share of 100 000, as nothing was paid as a fee.
fn without_protocol_fee() -> State {
    State::supplied(100_000, 0)
}

/// A vault holding 50 000 after the lender has withdrawn 50 000 of their share partially.
fn after_partial_withdrawal() -> State {
    State {
        withdrawn_amount: 50_000,
        ..with_protocol_fee()
    }
}

/// A vault holding only the protocol fee, the lender's share being withdrawn. No partial
/// withdrawal leaves it so, but the contract does not rely on that.
fn without_lender_share() -> State {
    State {
        withdrawn_amount: 95_000,
        ..with_protocol_fee()
    }
}

#[simplex::test]
fn liquidates_leaving_protocol_fee(context: TestContext) -> anyhow::Result<()> {
    for layout in [Layout::VaultFirst, Layout::VaultLast] {
        let mut fixture = Fixture::deploy(&context, with_protocol_fee())?;
        fixture.layout = layout;

        let lending_offer = fixture.lending_offer.explicit_asset();
        let lender_nft = fixture.lender_nft.explicit_asset();
        let fee = fixture.vault.available_protocol_fee()?;
        let expected = fixture
            .vault
            .get_storage()
            .with_lender_withdrawal(fixture.vault.available_lender_shares()?, true)?;

        fixture.apply(&context, fixture.liquidation_withdrawal())?;

        assert_eq!(fixture.vault_utxo.explicit_amount(), fee);
        assert_eq!(fixture.vault.get_storage(), expected);
        assert_eq!(fixture.vault.available_lender_shares()?, 0);

        for burned in [lending_offer, lender_nft] {
            assert!(
                chain::signer_utxo(&context, burned).is_err(),
                "the liquidation burns the LendingOffer and the LenderNFT"
            );
        }
    }

    Ok(())
}

#[simplex::test]
fn liquidates_after_partial_withdrawal(context: TestContext) -> anyhow::Result<()> {
    let mut fixture = Fixture::deploy(&context, after_partial_withdrawal())?;
    let fee = fixture.vault.available_protocol_fee()?;

    fixture.apply(&context, fixture.liquidation_withdrawal())?;

    assert_eq!(fixture.vault_utxo.explicit_amount(), fee);

    Ok(())
}

#[simplex::test]
fn closes_vault_without_protocol_fee(context: TestContext) -> anyhow::Result<()> {
    for layout in [Layout::VaultFirst, Layout::VaultLast] {
        let mut fixture = Fixture::deploy(&context, without_protocol_fee())?;
        fixture.layout = layout;

        fixture.close(&context, fixture.liquidation_withdrawal())?;
    }

    Ok(())
}

/// A finalized vault is repaid, so it cannot be liquidated.
#[simplex::test]
fn rejects_liquidation_of_finalized_vault(context: TestContext) -> anyhow::Result<()> {
    let fixture = Fixture::deploy(&context, with_protocol_fee().finalized())?;

    let spend = fixture.liquidation_withdrawal();

    expect::rejects(&context, &spend.tx, spend.vault_input);

    Ok(())
}

/// The liquidation is authorized by the LendingOffer the vault keeps in its state.
#[simplex::test]
fn rejects_lending_offer_input_with_another_asset(context: TestContext) -> anyhow::Result<()> {
    let fixture = Fixture::deploy(&context, with_protocol_fee())?;

    let mut spend = fixture.liquidation_withdrawal();
    let input = spend.auth_input(LENDING_OFFER);
    tamper::input_utxo(&mut spend.tx, input, fixture.harvester_auth.clone());

    expect::rejects(&context, &spend.tx, spend.vault_input);

    Ok(())
}

/// The burned output must hold the LendingOffer.
#[simplex::test]
fn rejects_lending_offer_output_with_another_asset(context: TestContext) -> anyhow::Result<()> {
    let fixture = Fixture::deploy(&context, with_protocol_fee())?;
    let other_asset = fixture.harvester_auth.explicit_asset();

    let mut spend = fixture.liquidation_withdrawal();
    let output = spend.auth_output(LENDING_OFFER);
    tamper::output(&mut spend.tx, output, |output| output.asset = other_asset);

    expect::rejects(&context, &spend.tx, spend.vault_input);

    Ok(())
}

/// The withdrawal is authorized by the LenderNFT the vault keeps in its state as well.
#[simplex::test]
fn rejects_lender_nft_input_with_another_asset(context: TestContext) -> anyhow::Result<()> {
    let fixture = Fixture::deploy(&context, with_protocol_fee())?;

    let mut spend = fixture.liquidation_withdrawal();
    let input = spend.auth_input(LENDER_NFT);
    tamper::input_utxo(&mut spend.tx, input, fixture.harvester_auth.clone());

    expect::rejects(&context, &spend.tx, spend.vault_input);

    Ok(())
}

/// The burned output must hold the LenderNFT.
#[simplex::test]
fn rejects_lender_nft_output_with_another_asset(context: TestContext) -> anyhow::Result<()> {
    let fixture = Fixture::deploy(&context, with_protocol_fee())?;
    let other_asset = fixture.harvester_auth.explicit_asset();

    let mut spend = fixture.liquidation_withdrawal();
    let output = spend.auth_output(LENDER_NFT);
    tamper::output(&mut spend.tx, output, |output| output.asset = other_asset);

    expect::rejects(&context, &spend.tx, spend.vault_input);

    Ok(())
}

/// The liquidation burns the LendingOffer, so the offer cannot go on.
#[simplex::test]
fn rejects_liquidation_keeping_lending_offer(context: TestContext) -> anyhow::Result<()> {
    let fixture = Fixture::deploy(&context, with_protocol_fee())?;
    let owner = chain::signer_script(&context);

    let mut spend = fixture.liquidation_withdrawal();
    let output = spend.auth_output(LENDING_OFFER);
    tamper::output(&mut spend.tx, output, |output| output.script_pubkey = owner);

    expect::rejects(&context, &spend.tx, spend.vault_input);

    Ok(())
}

/// The liquidation burns the LenderNFT, so the lender cannot withdraw again.
#[simplex::test]
fn rejects_liquidation_keeping_lender_nft(context: TestContext) -> anyhow::Result<()> {
    let fixture = Fixture::deploy(&context, with_protocol_fee())?;
    let owner = chain::signer_script(&context);

    let mut spend = fixture.liquidation_withdrawal();
    let output = spend.auth_output(LENDER_NFT);
    tamper::output(&mut spend.tx, output, |output| output.script_pubkey = owner);

    expect::rejects(&context, &spend.tx, spend.vault_input);

    Ok(())
}

#[simplex::test]
fn rejects_liquidation_without_lender_share(context: TestContext) -> anyhow::Result<()> {
    let fixture = Fixture::deploy(&context, without_lender_share())?;

    let spend = fixture.liquidation_withdrawal();

    expect::rejects(&context, &spend.tx, spend.vault_input);

    Ok(())
}

/// The lender cannot take the protocol fee by closing the vault while the fee is in it.
#[simplex::test]
fn rejects_closing_with_protocol_fee_left(context: TestContext) -> anyhow::Result<()> {
    let mut fixture = Fixture::deploy(&context, with_protocol_fee())?;
    fixture.layout = Layout::VaultLast;

    let mut spend = fixture.liquidation_withdrawal();
    spend.take_whole_balance(fixture.vault_utxo.explicit_amount());

    expect::rejects(&context, &spend.tx, spend.vault_input);

    Ok(())
}

/// The liquidated vault is finalized, so nothing can be supplied to it.
#[simplex::test]
fn rejects_unfinalized_successor(context: TestContext) -> anyhow::Result<()> {
    let fixture = Fixture::deploy(&context, with_protocol_fee())?;
    let unfinalized = fixture.vault_in(
        fixture
            .vault
            .get_storage()
            .with_lender_withdrawal(fixture.vault.available_lender_shares()?, false)?,
    );

    let mut spend = fixture.liquidation_withdrawal();
    let output = spend.vault_output();
    tamper::output(&mut spend.tx, output, |output| {
        output.script_pubkey = unfinalized.get_script_pubkey();
    });

    expect::rejects(&context, &spend.tx, spend.vault_input);

    Ok(())
}
