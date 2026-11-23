use simplex::TestContext;

use crate::lender_principal_vault::fixture::{Fixture, Layout, State};
use crate::support::{chain, expect, tamper};

/// The position of the LenderNFT among the auth UTXOs of a full withdrawal.
const LENDER_NFT: usize = 0;

/// A finalized vault holding 100 000: the lender's share of 95 000 and 5 000 of protocol fee.
fn with_protocol_fee() -> State {
    State::supplied(100_000, 50_000).finalized()
}

/// A finalized vault holding only the lender's share of 100 000, as nothing was paid as a fee.
fn without_protocol_fee() -> State {
    State::supplied(100_000, 0).finalized()
}

/// A finalized vault holding only the lender's share of 95 000, as the harvester has taken the fee.
fn after_harvest() -> State {
    State {
        withdrawn_protocol_fee: 5_000,
        ..with_protocol_fee()
    }
}

/// A finalized vault holding only the protocol fee of 5 000, as the lender has taken their share.
fn after_full_withdrawal() -> State {
    State {
        withdrawn_amount: 95_000,
        ..with_protocol_fee()
    }
}

#[simplex::test]
fn withdraws_whole_share_leaving_protocol_fee(context: TestContext) -> anyhow::Result<()> {
    for layout in [Layout::VaultFirst, Layout::VaultLast] {
        let mut fixture = Fixture::deploy(&context, with_protocol_fee())?;
        fixture.layout = layout;

        let lender_nft = fixture.lender_nft.explicit_asset();
        let fee = fixture.vault.available_protocol_fee()?;
        let expected = fixture
            .vault
            .get_storage()
            .with_lender_withdrawal(fixture.vault.available_lender_shares()?, true)?;

        fixture.apply(&context, fixture.full_withdrawal())?;

        assert_eq!(fixture.vault_utxo.explicit_amount(), fee);
        assert_eq!(fixture.vault.get_storage(), expected);
        assert_eq!(fixture.vault.available_lender_shares()?, 0);
        assert!(
            chain::signer_utxo(&context, lender_nft).is_err(),
            "the full withdrawal burns the LenderNFT"
        );
    }

    Ok(())
}

#[simplex::test]
fn closes_vault_without_protocol_fee(context: TestContext) -> anyhow::Result<()> {
    for layout in [Layout::VaultFirst, Layout::VaultLast] {
        let mut fixture = Fixture::deploy(&context, without_protocol_fee())?;
        fixture.layout = layout;

        fixture.close(&context, fixture.full_withdrawal())?;
    }

    Ok(())
}

#[simplex::test]
fn closes_vault_after_harvest(context: TestContext) -> anyhow::Result<()> {
    let fixture = Fixture::deploy(&context, after_harvest())?;

    fixture.close(&context, fixture.full_withdrawal())
}

/// Before the vault is finalized, the lender withdraws only partially.
#[simplex::test]
fn rejects_full_withdrawal_before_finalization(context: TestContext) -> anyhow::Result<()> {
    let fixture = Fixture::deploy(
        &context,
        State {
            is_finalized: false,
            ..with_protocol_fee()
        },
    )?;

    let spend = fixture.full_withdrawal();

    expect::rejects(&context, &spend.tx, spend.vault_input);

    Ok(())
}

/// The withdrawal is authorized by the LenderNFT the vault keeps in its state.
#[simplex::test]
fn rejects_lender_nft_input_with_another_asset(context: TestContext) -> anyhow::Result<()> {
    let fixture = Fixture::deploy(&context, with_protocol_fee())?;

    let mut spend = fixture.full_withdrawal();
    let input = spend.auth_input(LENDER_NFT);
    tamper::input_utxo(&mut spend.tx, input, fixture.lending_offer.clone());

    expect::rejects(&context, &spend.tx, spend.vault_input);

    Ok(())
}

/// The burned output must hold the LenderNFT.
#[simplex::test]
fn rejects_lender_nft_output_with_another_asset(context: TestContext) -> anyhow::Result<()> {
    let fixture = Fixture::deploy(&context, with_protocol_fee())?;
    let other_asset = fixture.lending_offer.explicit_asset();

    let mut spend = fixture.full_withdrawal();
    let output = spend.auth_output(LENDER_NFT);
    tamper::output(&mut spend.tx, output, |output| output.asset = other_asset);

    expect::rejects(&context, &spend.tx, spend.vault_input);

    Ok(())
}

/// The full withdrawal burns the LenderNFT, so the lender cannot withdraw again.
#[simplex::test]
fn rejects_full_withdrawal_keeping_lender_nft(context: TestContext) -> anyhow::Result<()> {
    let fixture = Fixture::deploy(&context, with_protocol_fee())?;
    let owner = chain::signer_script(&context);

    let mut spend = fixture.full_withdrawal();
    let output = spend.auth_output(LENDER_NFT);
    tamper::output(&mut spend.tx, output, |output| output.script_pubkey = owner);

    expect::rejects(&context, &spend.tx, spend.vault_input);

    Ok(())
}

/// Once the lender has taken their share, nothing is left for them to withdraw.
#[simplex::test]
fn rejects_withdrawal_without_lender_share(context: TestContext) -> anyhow::Result<()> {
    let fixture = Fixture::deploy(&context, after_full_withdrawal())?;

    let spend = fixture.full_withdrawal();

    expect::rejects(&context, &spend.tx, spend.vault_input);

    Ok(())
}

/// The lender cannot take the protocol fee by closing the vault while the fee is in it.
#[simplex::test]
fn rejects_closing_with_protocol_fee_left(context: TestContext) -> anyhow::Result<()> {
    let mut fixture = Fixture::deploy(&context, with_protocol_fee())?;
    fixture.layout = Layout::VaultLast;

    let mut spend = fixture.full_withdrawal();
    spend.take_whole_balance(fixture.vault_utxo.explicit_amount());

    expect::rejects(&context, &spend.tx, spend.vault_input);

    Ok(())
}

/// The vault the lender leaves stays finalized.
#[simplex::test]
fn rejects_unfinalized_successor(context: TestContext) -> anyhow::Result<()> {
    let fixture = Fixture::deploy(&context, with_protocol_fee())?;
    let unfinalized = fixture.vault_in(
        fixture
            .vault
            .get_storage()
            .with_lender_withdrawal(fixture.vault.available_lender_shares()?, false)?,
    );

    let mut spend = fixture.full_withdrawal();
    let output = spend.vault_output();
    tamper::output(&mut spend.tx, output, |output| {
        output.script_pubkey = unfinalized.get_script_pubkey();
    });

    expect::rejects(&context, &spend.tx, spend.vault_input);

    Ok(())
}
