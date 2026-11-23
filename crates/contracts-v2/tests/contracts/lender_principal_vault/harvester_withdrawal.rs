use simplex::TestContext;

use crate::lender_principal_vault::fixture::{Fixture, Layout, State};
use crate::support::{chain, expect, tamper};

/// The position of the harvester auth among the auth UTXOs of a harvester withdrawal.
const HARVESTER_AUTH: usize = 0;

/// A vault holding 100 000: the lender's share of 95 000 and 5 000 of protocol fee.
fn with_protocol_fee() -> State {
    State::supplied(100_000, 50_000)
}

/// A finalized vault holding only the protocol fee of 5 000, as the lender has taken their share
/// by a full or a liquidation withdrawal.
fn after_lender_withdrawal() -> State {
    State {
        withdrawn_amount: 95_000,
        ..with_protocol_fee().finalized()
    }
}

/// Vaults where the protocol has no fee to take: the harvester has taken it, nothing was paid as a
/// fee, or the protocol's part of the fee rounds down to nothing.
fn without_protocol_fee() -> [State; 3] {
    [
        State {
            withdrawn_protocol_fee: 5_000,
            ..with_protocol_fee()
        },
        State::supplied(100_000, 0),
        State::supplied(100_000, 9),
    ]
}

#[simplex::test]
fn harvests_before_finalization(context: TestContext) -> anyhow::Result<()> {
    for layout in [Layout::VaultFirst, Layout::VaultLast] {
        let mut fixture = Fixture::deploy(&context, with_protocol_fee())?;
        fixture.layout = layout;

        let harvester_auth = fixture.harvester_auth.explicit_asset();
        let shares = fixture.vault.available_lender_shares()?;
        let expected = fixture
            .vault
            .get_storage()
            .with_protocol_fee_withdrawal(fixture.vault.available_protocol_fee()?)?;

        fixture.apply(&context, fixture.harvester_withdrawal())?;

        assert_eq!(fixture.vault_utxo.explicit_amount(), shares);
        assert_eq!(fixture.vault.get_storage(), expected);
        assert_eq!(fixture.vault.available_protocol_fee()?, 0);
        assert!(
            chain::signer_utxo(&context, harvester_auth).is_ok(),
            "the harvester auth stays with the harvester"
        );
    }

    Ok(())
}

/// The harvester takes the fee from a finalized vault and leaves it finalized.
#[simplex::test]
fn harvests_after_finalization(context: TestContext) -> anyhow::Result<()> {
    let mut fixture = Fixture::deploy(&context, with_protocol_fee().finalized())?;

    fixture.apply(&context, fixture.harvester_withdrawal())?;

    assert!(fixture.vault.get_storage().is_finalized);

    Ok(())
}

#[simplex::test]
fn closes_vault_after_lender_withdrawal(context: TestContext) -> anyhow::Result<()> {
    for layout in [Layout::VaultFirst, Layout::VaultLast] {
        let mut fixture = Fixture::deploy(&context, after_lender_withdrawal())?;
        fixture.layout = layout;

        fixture.close(&context, fixture.harvester_withdrawal())?;
    }

    Ok(())
}

/// The withdrawal is authorized by the harvester auth of the protocol.
#[simplex::test]
fn rejects_harvester_auth_input_with_another_asset(context: TestContext) -> anyhow::Result<()> {
    let fixture = Fixture::deploy(&context, with_protocol_fee())?;

    let mut spend = fixture.harvester_withdrawal();
    let input = spend.auth_input(HARVESTER_AUTH);
    tamper::input_utxo(&mut spend.tx, input, fixture.lender_nft.clone());

    expect::rejects(&context, &spend.tx, spend.vault_input);

    Ok(())
}

/// The harvester auth must stay in the transaction outputs.
#[simplex::test]
fn rejects_harvester_auth_output_with_another_asset(context: TestContext) -> anyhow::Result<()> {
    let fixture = Fixture::deploy(&context, with_protocol_fee())?;
    let other_asset = fixture.lender_nft.explicit_asset();

    let mut spend = fixture.harvester_withdrawal();
    let output = spend.auth_output(HARVESTER_AUTH);
    tamper::output(&mut spend.tx, output, |output| output.asset = other_asset);

    expect::rejects(&context, &spend.tx, spend.vault_input);

    Ok(())
}

/// The harvester keeps their auth for the fee of the other vaults.
#[simplex::test]
fn rejects_withdrawal_burning_harvester_auth(context: TestContext) -> anyhow::Result<()> {
    let fixture = Fixture::deploy(&context, with_protocol_fee())?;

    let mut spend = fixture.harvester_withdrawal();
    let output = spend.auth_output(HARVESTER_AUTH);
    tamper::output(&mut spend.tx, output, |output| {
        output.script_pubkey = chain::burn_script();
    });

    expect::rejects(&context, &spend.tx, spend.vault_input);

    Ok(())
}

#[simplex::test]
fn rejects_withdrawal_without_protocol_fee(context: TestContext) -> anyhow::Result<()> {
    for state in without_protocol_fee() {
        let fixture = Fixture::deploy(&context, state)?;

        let spend = fixture.harvester_withdrawal();

        expect::rejects(&context, &spend.tx, spend.vault_input);
    }

    Ok(())
}

/// The harvester cannot take the lender's share by closing the vault while the share is in it.
#[simplex::test]
fn rejects_closing_with_lender_share_left(context: TestContext) -> anyhow::Result<()> {
    let mut fixture = Fixture::deploy(&context, with_protocol_fee())?;
    fixture.layout = Layout::VaultLast;

    let mut spend = fixture.harvester_withdrawal();
    spend.take_whole_balance(fixture.vault_utxo.explicit_amount());

    expect::rejects(&context, &spend.tx, spend.vault_input);

    Ok(())
}

/// The harvester does not change whether the vault is finalized.
#[simplex::test]
fn rejects_successor_with_another_finalization(context: TestContext) -> anyhow::Result<()> {
    for state in [with_protocol_fee(), with_protocol_fee().finalized()] {
        let fixture = Fixture::deploy(&context, state)?;

        let mut flipped = fixture
            .vault
            .get_storage()
            .with_protocol_fee_withdrawal(fixture.vault.available_protocol_fee()?)?;
        flipped.is_finalized = !flipped.is_finalized;
        let flipped = fixture.vault_in(flipped);

        let mut spend = fixture.harvester_withdrawal();
        let output = spend.vault_output();
        tamper::output(&mut spend.tx, output, |output| {
            output.script_pubkey = flipped.get_script_pubkey();
        });

        expect::rejects(&context, &spend.tx, spend.vault_input);
    }

    Ok(())
}
