use lending_contracts::programs::pre_lock::{PreLock, PreLockParameters};
use lending_contracts::utils::LendingOfferParameters;
use simplex::simplicityhl::elements::Txid;
use simplex::transaction::{FinalTransaction, PartialInput, RequiredSignature};
use simplex::utils::hash_script;

use super::common::issuance::{issue_asset, issue_preparation_utxos_tx, issue_utility_nfts_tx};
use super::common::tx_steps::finalize_and_broadcast;
use super::common::wallet::split_first_signer_utxo;

pub(super) fn setup_pre_lock(
    context: &simplex::TestContext,
    offer_parameters: LendingOfferParameters,
    principal_asset_amount: u64,
) -> anyhow::Result<(Txid, PreLock, PreLockParameters)> {
    let provider = context.get_default_provider();
    let signer = context.get_default_signer();

    let txid = split_first_signer_utxo(
        context,
        vec![1000, 2000, offer_parameters.collateral_amount],
    );
    provider.wait(&txid)?;

    let (txid, principal_asset_id) = issue_asset(&context, principal_asset_amount)?;
    provider.wait(&txid)?;

    let (txid, preparation_asset_id) = issue_preparation_utxos_tx(&context)?;
    provider.wait(&txid)?;

    let txid = issue_utility_nfts_tx(&context, &offer_parameters, preparation_asset_id)?;
    provider.wait(&txid)?;

    let utility_nfts_creation_tx = provider.fetch_transaction(&txid)?;

    let first_parameters_nft_asset_id =
        utility_nfts_creation_tx.output[0].asset.explicit().unwrap();
    let second_parameters_nft_asset_id =
        utility_nfts_creation_tx.output[1].asset.explicit().unwrap();
    let borrower_nft_asset_id = utility_nfts_creation_tx.output[2].asset.explicit().unwrap();
    let lender_nft_asset_id = utility_nfts_creation_tx.output[3].asset.explicit().unwrap();

    let borrower_output_script_hash = hash_script(&signer.get_address().script_pubkey());

    let pre_lock_parameters = PreLockParameters {
        collateral_asset_id: provider.get_network().policy_asset(),
        first_parameters_nft_asset_id,
        second_parameters_nft_asset_id,
        borrower_nft_asset_id,
        lender_nft_asset_id,
        offer_parameters,
        principal_asset_id,
        borrower_pubkey: signer.get_schnorr_public_key(),
        borrower_output_script_hash: borrower_output_script_hash,
        network: *provider.get_network(),
    };

    let pre_lock = PreLock::new(pre_lock_parameters);

    let collateral_utxo = signer.get_utxos_filter(
        &|utxo| {
            utxo.explicit_asset() == pre_lock_parameters.collateral_asset_id
                && utxo.explicit_amount() >= pre_lock_parameters.offer_parameters.collateral_amount
        },
        &|_| true,
    )?[0]
        .clone();

    let first_parameters_utxo = signer.get_utxos_asset(first_parameters_nft_asset_id)?[0].clone();
    let second_parameters_utxo = signer.get_utxos_asset(second_parameters_nft_asset_id)?[0].clone();
    let borrower_nft_utxo = signer.get_utxos_asset(borrower_nft_asset_id)?[0].clone();
    let lender_nft_utxo = signer.get_utxos_asset(lender_nft_asset_id)?[0].clone();

    let mut ft = FinalTransaction::new();

    ft.add_input(
        PartialInput::new(collateral_utxo.clone()),
        RequiredSignature::NativeEcdsa,
    );
    ft.add_input(
        PartialInput::new(first_parameters_utxo.clone()),
        RequiredSignature::NativeEcdsa,
    );
    ft.add_input(
        PartialInput::new(second_parameters_utxo.clone()),
        RequiredSignature::NativeEcdsa,
    );
    ft.add_input(
        PartialInput::new(borrower_nft_utxo.clone()),
        RequiredSignature::NativeEcdsa,
    );
    ft.add_input(
        PartialInput::new(lender_nft_utxo.clone()),
        RequiredSignature::NativeEcdsa,
    );

    pre_lock.attach_creation(&mut ft, 1);

    let txid = finalize_and_broadcast(context, &ft)?;
    provider.wait(&txid)?;

    Ok((txid, pre_lock, pre_lock_parameters))
}
