use lending_contracts::{
    programs::{Lending, PreLock, PreLockParameters},
    transactions::{
        core::SimplexInput,
        pre_lock::{cancel_pre_lock, create_lending_from_pre_lock, create_pre_lock},
    },
    utils::LendingOfferParameters,
};
use simplex::transaction::{PartialInput, PartialOutput, RequiredSignature};
use simplicityhl::elements::{AssetId, OutPoint, Txid};

use super::common::issuance::{issue_asset, issue_preparation_utxos_tx, issue_utility_nfts_tx};
use super::common::tx_steps::{finalize_and_broadcast, finalize_strict_and_broadcast, wait_for_tx};
use super::common::wallet::{
    AmountFilter, filter_signer_utxos_by_asset_and_amount, filter_signer_utxos_by_asset_id,
    filter_utxos_by_amount, get_split_utxo_ft, split_first_signer_utxo,
};

pub(super) fn create_pre_lock_tx(
    context: &simplex::TestContext,
    offer_parameters: &LendingOfferParameters,
    principal_asset_id: AssetId,
    utility_nfts_issuance_txid: Txid,
) -> anyhow::Result<(Txid, PreLock)> {
    let provider = context.get_provider();
    let network = context.get_network();
    let signer = context.get_signer();

    let utility_nfts_tx = provider.fetch_transaction(&utility_nfts_issuance_txid)?;
    let signer_schnorr_pubkey = signer.get_schnorr_public_key()?;
    let first_parameters_nft_asset_id = utility_nfts_tx.output[0].asset.explicit().unwrap();
    let second_parameters_nft_asset_id = utility_nfts_tx.output[1].asset.explicit().unwrap();
    let borrower_nft_asset_id = utility_nfts_tx.output[2].asset.explicit().unwrap();
    let lender_nft_asset_id = utility_nfts_tx.output[3].asset.explicit().unwrap();

    let pre_lock_parameters = PreLockParameters {
        collateral_asset_id: network.policy_asset(),
        principal_asset_id,
        first_parameters_nft_asset_id,
        second_parameters_nft_asset_id,
        borrower_nft_asset_id,
        lender_nft_asset_id,
        offer_parameters: offer_parameters.clone(),
        borrower_pubkey: signer_schnorr_pubkey.serialize(),
        network: *network,
    };

    let collateral_utxos = filter_signer_utxos_by_asset_and_amount(
        signer,
        network.policy_asset(),
        offer_parameters.collateral_amount,
        AmountFilter::GreaterThan,
    );
    let collateral_utxos =
        filter_utxos_by_amount(collateral_utxos, 100_000, AmountFilter::LessThan);

    assert!(
        collateral_utxos.len() > 1,
        "No UTXOs serving as collateral were found"
    );
    let collateral_utxo = collateral_utxos.first().unwrap();

    let (ft, pre_lock) = create_pre_lock(
        &SimplexInput::new(
            collateral_utxo.0,
            collateral_utxo.1.clone(),
            RequiredSignature::NativeEcdsa,
        ),
        &SimplexInput::new(
            OutPoint::new(utility_nfts_issuance_txid, 0),
            utility_nfts_tx.output[0].clone(),
            RequiredSignature::NativeEcdsa,
        ),
        &SimplexInput::new(
            OutPoint::new(utility_nfts_issuance_txid, 1),
            utility_nfts_tx.output[1].clone(),
            RequiredSignature::NativeEcdsa,
        ),
        &SimplexInput::new(
            OutPoint::new(utility_nfts_issuance_txid, 2),
            utility_nfts_tx.output[2].clone(),
            RequiredSignature::NativeEcdsa,
        ),
        &SimplexInput::new(
            OutPoint::new(utility_nfts_issuance_txid, 3),
            utility_nfts_tx.output[3].clone(),
            RequiredSignature::NativeEcdsa,
        ),
        pre_lock_parameters,
    )?;

    let txid = finalize_and_broadcast(context, &ft)?;
    Ok((txid, pre_lock))
}

pub(super) fn create_lending_from_pre_lock_tx(
    context: &simplex::TestContext,
    pre_lock: PreLock,
    pre_lock_txid: Txid,
) -> anyhow::Result<(Txid, Lending)> {
    let provider = context.get_provider();
    let network = context.get_network();
    let signer = context.get_signer();

    let pre_lock_parameters = pre_lock.get_pre_lock_parameters();

    let principal_utxos =
        filter_signer_utxos_by_asset_id(signer, pre_lock_parameters.principal_asset_id);
    let utxo_to_split = principal_utxos.first().unwrap();
    let ft = get_split_utxo_ft(
        (utxo_to_split.0, utxo_to_split.1.clone()),
        vec![pre_lock_parameters.offer_parameters.principal_amount],
        signer,
        *network,
    );

    let txid = finalize_and_broadcast(context, &ft)?;
    wait_for_tx(context, &txid)?;

    let principal_utxos = filter_signer_utxos_by_asset_and_amount(
        signer,
        pre_lock_parameters.principal_asset_id,
        pre_lock_parameters.offer_parameters.principal_amount,
        AmountFilter::EqualTo,
    );
    let principal_utxo = principal_utxos.first().unwrap();

    let pre_lock_creation_tx = provider.fetch_transaction(&pre_lock_txid)?;

    let (mut ft, lending) = create_lending_from_pre_lock(
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
        vec![&SimplexInput::new(
            principal_utxo.0,
            principal_utxo.1.clone(),
            RequiredSignature::NativeEcdsa,
        )],
        PartialOutput::new(
            signer.get_wpkh_address().unwrap().script_pubkey(),
            1,
            pre_lock_parameters.lender_nft_asset_id,
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

    let txid = finalize_strict_and_broadcast(context, &ft)?;
    Ok((txid, lending))
}

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

    let txid = finalize_strict_and_broadcast(context, &ft)?;
    Ok(txid)
}

pub(super) fn setup_pre_lock(context: &simplex::TestContext) -> anyhow::Result<(Txid, PreLock)> {
    let txid = split_first_signer_utxo(context, vec![1000, 2000, 5000]);
    wait_for_tx(context, &txid)?;

    let (txid, preparation_asset_id) = issue_preparation_utxos_tx(context)?;
    wait_for_tx(context, &txid)?;

    let (txid, principal_asset_id) = issue_asset(context, 20000)?;
    wait_for_tx(context, &txid)?;

    let offer_parameters = LendingOfferParameters {
        collateral_amount: 1000,
        principal_amount: 5000,
        loan_expiration_time: 110,
        principal_interest_rate: 200,
    };

    let txid = issue_utility_nfts_tx(context, &offer_parameters, preparation_asset_id)?;
    wait_for_tx(context, &txid)?;

    create_pre_lock_tx(context, &offer_parameters, principal_asset_id, txid)
}
