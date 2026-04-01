#![allow(dead_code)]
use lending_contracts::{
    programs::{Lending, PreLock, PreLockParameters},
    transactions::{
        core::SimplexInput,
        pre_lock::{create_lending_from_pre_lock, create_pre_lock},
    },
    utils::LendingOfferParameters,
};
use simplex::transaction::{PartialInput, PartialOutput, RequiredSignature, UTXO};
use simplex::{
    simplicityhl::elements::{AssetId, OutPoint, Txid},
    utils::hash_script,
};

use super::super::issuance::{issue_asset, issue_preparation_utxos_tx, issue_utility_nfts_tx};
use super::super::tx_steps::{finalize_and_broadcast, finalize_strict_and_broadcast, wait_for_tx};
use super::super::wallet::{
    AmountFilter, filter_signer_utxos_by_asset_and_amount, filter_signer_utxos_by_asset_id,
    filter_utxos_by_amount, get_split_utxo_ft, split_first_signer_utxo,
};

pub struct PreLockFixture {
    pub pre_lock_txid: Txid,
    pub pre_lock: PreLock,
    pub offer_parameters: LendingOfferParameters,
    pub principal_asset_id: AssetId,
}

pub struct LendingFixture {
    pub pre_lock_txid: Txid,
    pub lending_txid: Txid,
    pub lending: Lending,
}

pub fn create_pre_lock_tx(
    context: &simplex::TestContext,
    offer_parameters: &LendingOfferParameters,
    principal_asset_id: AssetId,
    utility_nfts_issuance_txid: Txid,
) -> anyhow::Result<(Txid, PreLock)> {
    let provider = context.get_default_provider();
    let network = context.get_network();
    let signer = context.get_default_signer();

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
        offer_parameters: *offer_parameters,
        borrower_pubkey: signer_schnorr_pubkey,
        borrower_output_script_hash: hash_script(&signer.get_address().unwrap().script_pubkey()),
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
        &SimplexInput::new(collateral_utxo, RequiredSignature::NativeEcdsa),
        &SimplexInput::new(
            &UTXO {
                outpoint: OutPoint::new(utility_nfts_issuance_txid, 0),
                txout: utility_nfts_tx.output[0].clone(),
                secrets: None,
            },
            RequiredSignature::NativeEcdsa,
        ),
        &SimplexInput::new(
            &UTXO {
                outpoint: OutPoint::new(utility_nfts_issuance_txid, 1),
                txout: utility_nfts_tx.output[1].clone(),
                secrets: None,
            },
            RequiredSignature::NativeEcdsa,
        ),
        &SimplexInput::new(
            &UTXO {
                outpoint: OutPoint::new(utility_nfts_issuance_txid, 2),
                txout: utility_nfts_tx.output[2].clone(),
                secrets: None,
            },
            RequiredSignature::NativeEcdsa,
        ),
        &SimplexInput::new(
            &UTXO {
                outpoint: OutPoint::new(utility_nfts_issuance_txid, 3),
                txout: utility_nfts_tx.output[3].clone(),
                secrets: None,
            },
            RequiredSignature::NativeEcdsa,
        ),
        pre_lock_parameters,
    )?;

    let txid = finalize_and_broadcast(context, &ft)?;
    Ok((txid, pre_lock))
}

pub fn create_lending_from_pre_lock_tx(
    context: &simplex::TestContext,
    pre_lock: PreLock,
    pre_lock_txid: Txid,
) -> anyhow::Result<(Txid, Lending)> {
    let provider = context.get_default_provider();
    let network = context.get_network();
    let signer = context.get_default_signer();

    let pre_lock_parameters = pre_lock.get_pre_lock_parameters();
    let principal_utxos =
        filter_signer_utxos_by_asset_id(signer, pre_lock_parameters.principal_asset_id);
    let utxo_to_split = principal_utxos.first().unwrap();
    let ft = get_split_utxo_ft(
        utxo_to_split.clone(),
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
        UTXO {
            outpoint: OutPoint::new(pre_lock_txid, 0),
            txout: pre_lock_creation_tx.output[0].clone(),
            secrets: None,
        },
        UTXO {
            outpoint: OutPoint::new(pre_lock_txid, 1),
            txout: pre_lock_creation_tx.output[1].clone(),
            secrets: None,
        },
        UTXO {
            outpoint: OutPoint::new(pre_lock_txid, 2),
            txout: pre_lock_creation_tx.output[2].clone(),
            secrets: None,
        },
        UTXO {
            outpoint: OutPoint::new(pre_lock_txid, 3),
            txout: pre_lock_creation_tx.output[3].clone(),
            secrets: None,
        },
        UTXO {
            outpoint: OutPoint::new(pre_lock_txid, 4),
            txout: pre_lock_creation_tx.output[4].clone(),
            secrets: None,
        },
        vec![&SimplexInput::new(
            principal_utxo,
            RequiredSignature::NativeEcdsa,
        )],
        PartialOutput::new(
            signer.get_address().unwrap().script_pubkey(),
            1,
            pre_lock_parameters.lender_nft_asset_id,
        ),
        signer.get_address().unwrap().script_pubkey(),
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
        PartialInput::new(fee_utxo.clone()),
        RequiredSignature::NativeEcdsa,
    )?;

    let txid = finalize_strict_and_broadcast(context, &ft)?;
    Ok((txid, lending))
}

pub fn setup_pre_lock(context: &simplex::TestContext) -> anyhow::Result<(Txid, PreLock)> {
    Ok(setup_pre_lock_fixture(context)?.into())
}

pub fn setup_pre_lock_fixture(context: &simplex::TestContext) -> anyhow::Result<PreLockFixture> {
    let txid = split_first_signer_utxo(context, vec![1000, 2000, 5000]);
    wait_for_tx(context, &txid)?;

    let (txid, preparation_asset_id) = issue_preparation_utxos_tx(context)?;
    wait_for_tx(context, &txid)?;

    let (txid, principal_asset_id) = issue_asset(context, 20000)?;
    wait_for_tx(context, &txid)?;

    let current_height = context.get_default_provider().fetch_tip_height()?;

    let offer_parameters = LendingOfferParameters {
        collateral_amount: 1000,
        principal_amount: 5000,
        loan_expiration_time: current_height + 10,
        principal_interest_rate: 200,
    };

    let txid = issue_utility_nfts_tx(context, &offer_parameters, preparation_asset_id)?;
    wait_for_tx(context, &txid)?;

    let (pre_lock_txid, pre_lock) =
        create_pre_lock_tx(context, &offer_parameters, principal_asset_id, txid)?;

    Ok(PreLockFixture {
        pre_lock_txid,
        pre_lock,
        offer_parameters,
        principal_asset_id,
    })
}

pub fn setup_lending_fixture(context: &simplex::TestContext) -> anyhow::Result<LendingFixture> {
    let pre_lock_fixture = setup_pre_lock_fixture(context)?;
    wait_for_tx(context, &pre_lock_fixture.pre_lock_txid)?;

    let PreLockFixture {
        pre_lock_txid,
        pre_lock,
        offer_parameters: _offer_parameters,
        principal_asset_id: _principal_asset_id,
    } = pre_lock_fixture;

    let (lending_txid, lending) =
        create_lending_from_pre_lock_tx(context, pre_lock, pre_lock_txid)?;

    Ok(LendingFixture {
        pre_lock_txid,
        lending_txid,
        lending,
    })
}

impl From<PreLockFixture> for (Txid, PreLock) {
    fn from(value: PreLockFixture) -> Self {
        (value.pre_lock_txid, value.pre_lock)
    }
}
