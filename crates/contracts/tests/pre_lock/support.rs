use lending_contracts::{
    artifacts::{
        asset_auth::derived_asset_auth::AssetAuthArguments,
        lending::derived_lending::LendingArguments, pre_lock::derived_pre_lock::PreLockArguments,
        script_auth::derived_script_auth::ScriptAuthArguments,
    },
    programs::{AssetAuth, Lending, PreLock, ScriptAuth, program::SimplexProgram},
    transactions::pre_lock::{cancel_pre_lock, create_lending_from_pre_lock, create_pre_lock},
    utils::LendingParameters,
};
use simplex::{
    transaction::{PartialInput, PartialOutput, RequiredSignature},
    utils::hash_script,
};
use simplicityhl::elements::{AssetId, OutPoint, Txid, hashes::sha256::Midstate};

use super::common::issuance::{issue_asset, issue_preparation_utxos_tx, issue_utility_nfts_tx};
use super::common::tx_steps::{finalize_and_broadcast, finalize_strict_and_broadcast, wait_for_tx};
use super::common::wallet::{
    AmountFilter, filter_signer_utxos_by_asset_and_amount, filter_signer_utxos_by_asset_id,
    filter_utxos_by_amount, get_split_utxo_ft, split_first_signer_utxo,
};

pub(super) fn create_pre_lock_tx(
    context: &simplex::TestContext,
    offer_parameters: &LendingParameters,
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

    let signer_wpkh_script_pubkey = signer.get_wpkh_address().unwrap().script_pubkey();
    let borrower_output_script_hash = hash_script(&signer_wpkh_script_pubkey);

    let lender_principal_asset_auth = AssetAuth::new(
        AssetAuthArguments {
            asset_id: lender_nft_asset_id.into_inner().0,
            asset_amount: 1,
            with_asset_burn: true,
        },
        *context.get_network(),
    );

    let lending_arguments = LendingArguments {
        first_parameters_nft_asset_id: first_parameters_nft_asset_id.into_inner().0,
        second_parameters_nft_asset_id: second_parameters_nft_asset_id.into_inner().0,
        borrower_nft_asset_id: borrower_nft_asset_id.into_inner().0,
        lender_nft_asset_id: lender_nft_asset_id.into_inner().0,
        collateral_asset_id: context.get_network().policy_asset().into_inner().0,
        principal_asset_id: principal_asset_id.into_inner().0,
        collateral_amount: offer_parameters.collateral_amount,
        principal_amount: offer_parameters.principal_amount,
        loan_expiration_time: offer_parameters.loan_expiration_time,
        principal_interest_rate: offer_parameters.principal_interest_rate,
        lender_principal_cov_hash: lender_principal_asset_auth.get_script_hash()?,
    };

    let lending = Lending::new(lending_arguments, *context.get_network());
    let parameters_script_auth = ScriptAuth::new(
        ScriptAuthArguments {
            script_hash: lending.get_script_hash()?,
        },
        *context.get_network(),
    );

    let pre_lock_arguments = PreLockArguments {
        first_parameters_nft_asset_id: first_parameters_nft_asset_id.into_inner().0,
        second_parameters_nft_asset_id: second_parameters_nft_asset_id.into_inner().0,
        borrower_nft_asset_id: borrower_nft_asset_id.into_inner().0,
        lender_nft_asset_id: lender_nft_asset_id.into_inner().0,
        collateral_asset_id: context.get_network().policy_asset().into_inner().0,
        principal_asset_id: principal_asset_id.into_inner().0,
        collateral_amount: offer_parameters.collateral_amount,
        principal_amount: offer_parameters.principal_amount,
        loan_expiration_time: offer_parameters.loan_expiration_time,
        principal_interest_rate: offer_parameters.principal_interest_rate,
        borrower_pub_key: signer_schnorr_pubkey.serialize(),
        borrower_nft_output_script_hash: borrower_output_script_hash.clone(),
        principal_output_script_hash: borrower_output_script_hash,
        lending_cov_hash: lending.get_script_hash()?,
        parameters_nft_output_script_hash: parameters_script_auth.get_script_hash()?,
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
        (
            PartialInput::new(collateral_utxo.0, collateral_utxo.1.clone()),
            RequiredSignature::NativeEcdsa,
        ),
        (
            PartialInput::new(
                OutPoint::new(utility_nfts_issuance_txid, 0),
                utility_nfts_tx.output[0].clone(),
            ),
            RequiredSignature::NativeEcdsa,
        ),
        (
            PartialInput::new(
                OutPoint::new(utility_nfts_issuance_txid, 1),
                utility_nfts_tx.output[1].clone(),
            ),
            RequiredSignature::NativeEcdsa,
        ),
        (
            PartialInput::new(
                OutPoint::new(utility_nfts_issuance_txid, 2),
                utility_nfts_tx.output[2].clone(),
            ),
            RequiredSignature::NativeEcdsa,
        ),
        (
            PartialInput::new(
                OutPoint::new(utility_nfts_issuance_txid, 3),
                utility_nfts_tx.output[3].clone(),
            ),
            RequiredSignature::NativeEcdsa,
        ),
        *network,
        pre_lock_arguments,
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

    let pre_lock_arguments = pre_lock.get_pre_lock_arguments();
    let principal_asset_id = AssetId::from_inner(Midstate(pre_lock_arguments.principal_asset_id));

    let principal_utxos = filter_signer_utxos_by_asset_id(signer, principal_asset_id);
    let utxo_to_split = principal_utxos.first().unwrap();
    let ft = get_split_utxo_ft(
        (utxo_to_split.0, utxo_to_split.1.clone()),
        vec![pre_lock_arguments.principal_amount],
        signer,
        *network,
    );

    let txid = finalize_and_broadcast(context, &ft)?;
    wait_for_tx(context, &txid)?;

    let principal_utxos = filter_signer_utxos_by_asset_and_amount(
        signer,
        principal_asset_id,
        pre_lock_arguments.principal_amount,
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
        vec![(
            PartialInput::new(principal_utxo.0, principal_utxo.1.clone()),
            RequiredSignature::NativeEcdsa,
        )],
        signer.get_wpkh_address().unwrap().script_pubkey(),
        PartialOutput::new(
            signer.get_wpkh_address().unwrap().script_pubkey(),
            1,
            AssetId::from_inner(Midstate(pre_lock_arguments.lender_nft_asset_id)),
        ),
        pre_lock,
        *network,
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

    let pre_lock_arguments = pre_lock.get_pre_lock_arguments();
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
            pre_lock_arguments.collateral_amount,
            network.policy_asset(),
        ),
        pre_lock,
        *network,
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

    let offer_parameters = LendingParameters {
        collateral_amount: 1000,
        principal_amount: 5000,
        loan_expiration_time: 110,
        principal_interest_rate: 200,
    };

    let txid = issue_utility_nfts_tx(context, &offer_parameters, preparation_asset_id)?;
    wait_for_tx(context, &txid)?;

    create_pre_lock_tx(context, &offer_parameters, principal_asset_id, txid)
}
