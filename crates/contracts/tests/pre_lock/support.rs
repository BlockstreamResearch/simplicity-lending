use lending_contracts::{programs::PreLock, transactions::pre_lock::cancel_pre_lock};
use simplex::simplicityhl::elements::{OutPoint, Txid};
use simplex::transaction::{PartialInput, PartialOutput, RequiredSignature};

use super::common::flows::pre_lock_flow;
use super::common::tx_steps::finalize_strict_and_broadcast;
use super::common::wallet::{AmountFilter, filter_signer_utxos_by_asset_and_amount};

pub(super) use pre_lock_flow::{create_lending_from_pre_lock_tx, setup_pre_lock};

pub(super) fn cancel_pre_lock_tx(
    context: &simplex::TestContext,
    pre_lock: PreLock,
    pre_lock_txid: Txid,
) -> anyhow::Result<Txid> {
    let provider = context.get_provider();
    let network = context.get_network();
    let signer = context.get_signer();

    let pre_lock_parameters = pre_lock.get_pre_lock_parameters();
    let pre_lock_creation_tx = provider.fetch_transaction(&pre_lock_txid)?;

    let mut ft = cancel_pre_lock(
        (
            OutPoint::new(pre_lock_txid, 0),
            pre_lock_creation_tx.output[0].clone(),
        ),
        (
            OutPoint::new(pre_lock_txid, 1),
            pre_lock_creation_tx.output[1].clone(),
        ),
        (
            OutPoint::new(pre_lock_txid, 2),
            pre_lock_creation_tx.output[2].clone(),
        ),
        (
            OutPoint::new(pre_lock_txid, 3),
            pre_lock_creation_tx.output[3].clone(),
        ),
        (
            OutPoint::new(pre_lock_txid, 4),
            pre_lock_creation_tx.output[4].clone(),
        ),
        PartialOutput::new(
            signer.get_wpkh_address().unwrap().script_pubkey(),
            pre_lock_parameters.offer_parameters.collateral_amount,
            network.policy_asset(),
        ),
        pre_lock,
    )?;

    let signer_policy_utxos = filter_signer_utxos_by_asset_and_amount(
        signer,
        context.get_network().policy_asset(),
        100_000,
        AmountFilter::LessThan,
    );
    let fee_utxo = signer_policy_utxos.first().unwrap();

    ft.add_input(
        PartialInput::new(fee_utxo.0, fee_utxo.1.clone()),
        RequiredSignature::NativeEcdsa,
    )?;

    finalize_strict_and_broadcast(context, &ft)
}
