#![allow(dead_code)]

use anyhow::Context;
use lending_contracts::utils::get_random_seed;
use lending_session::Session;
use simplex::signer::Signer;
use simplex::simplicityhl::elements::AssetId;
use simplex::transaction::partial_input::IssuanceInput;
use simplex::transaction::{FinalTransaction, PartialInput, PartialOutput, RequiredSignature};

pub fn issue_asset(session: &Session, asset_amount: u64) -> anyhow::Result<AssetId> {
    let signer = session.signer();
    let policy_asset = session.network().policy_asset();
    let funding_utxo = signer
        .get_utxos_asset(policy_asset)?
        .into_iter()
        .next()
        .context("expected a policy UTXO to fund asset issuance")?;

    let mut tx = FinalTransaction::new();
    let issuance = tx.add_issuance_input(
        PartialInput::new(funding_utxo.clone()),
        IssuanceInput::new_issuance(asset_amount, 0, get_random_seed()),
        RequiredSignature::NativeEcdsa,
    );

    let script = signer.get_address().script_pubkey();
    tx.add_output(PartialOutput::new(
        script.clone(),
        asset_amount,
        issuance.asset_id,
    ));
    let policy_change = funding_utxo
        .amount()
        .checked_sub(500)
        .context("policy UTXO too small to cover issuance fee")?;
    tx.add_output(PartialOutput::new(script, policy_change, policy_asset));

    signer.broadcast(&tx)?.wait()?;

    Ok(issuance.asset_id)
}

pub fn fund_asset_outputs(
    from: &Session,
    to: &Signer,
    asset_id: AssetId,
    amounts: &[u64],
) -> anyhow::Result<()> {
    anyhow::ensure!(
        !amounts.is_empty(),
        "at least one output amount is required"
    );

    let total_amount: u64 = amounts.iter().copied().sum();
    let from_signer = from.signer();
    let policy_asset = from.network().policy_asset();

    let asset_utxo = from_signer
        .get_utxos_asset(asset_id)?
        .into_iter()
        .find(|utxo| utxo.amount() >= total_amount)
        .context("sender does not have enough of the funded asset")?;
    let policy_utxo = from_signer
        .get_utxos_asset(policy_asset)?
        .into_iter()
        .next()
        .context("expected a policy UTXO for the funding fee")?;

    let asset_utxo_amount = asset_utxo.amount();
    let policy_utxo_amount = policy_utxo.amount();
    let policy_to_send = policy_utxo_amount / 2;
    anyhow::ensure!(
        policy_to_send > 0,
        "policy UTXO too small to fund recipient fees"
    );

    let to_script = to.get_address().script_pubkey();
    let from_script = from_signer.get_address().script_pubkey();

    let mut tx = FinalTransaction::new();
    tx.add_input(
        PartialInput::new(asset_utxo),
        RequiredSignature::NativeEcdsa,
    );
    tx.add_input(
        PartialInput::new(policy_utxo),
        RequiredSignature::NativeEcdsa,
    );

    for &amount in amounts {
        tx.add_output(PartialOutput::new(to_script.clone(), amount, asset_id));
    }
    tx.add_output(PartialOutput::new(to_script, policy_to_send, policy_asset));

    if asset_utxo_amount > total_amount {
        tx.add_output(PartialOutput::new(
            from_script,
            asset_utxo_amount - total_amount,
            asset_id,
        ));
    }

    from_signer.broadcast(&tx)?.wait()?;

    Ok(())
}

pub fn fund_policy_output(from: &Session, to: &Signer, amount: u64) -> anyhow::Result<()> {
    let policy_asset = from.network().policy_asset();
    let from_signer = from.signer();
    const FEE_RESERVE: u64 = 500;
    let policy_utxo = from_signer
        .get_utxos_asset(policy_asset)?
        .into_iter()
        .find(|utxo| utxo.amount() >= amount + FEE_RESERVE)
        .context("sender does not have enough policy asset to fund recipient")?;

    let input_amount = policy_utxo.amount();
    let mut tx = FinalTransaction::new();
    tx.add_input(
        PartialInput::new(policy_utxo),
        RequiredSignature::NativeEcdsa,
    );
    tx.add_output(PartialOutput::new(
        to.get_address().script_pubkey(),
        amount,
        policy_asset,
    ));

    if input_amount > amount + FEE_RESERVE {
        tx.add_output(PartialOutput::new(
            from_signer.get_address().script_pubkey(),
            input_amount - amount - FEE_RESERVE,
            policy_asset,
        ));
    }

    from_signer.broadcast(&tx)?.wait()?;
    Ok(())
}
