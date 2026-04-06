use simplex::{provider::ProviderTrait, simplicityhl::elements::Transaction, utils::hash_script};

use crate::{
    programs::{PreLock, PreLockParameters},
    transactions::pre_lock::PreLockTransactionError,
    utils::{FirstNFTParameters, LendingOfferParameters, SecondNFTParameters},
};

pub fn extract_pre_lock_parameters_from_tx(
    tx: &Transaction,
    provider: &impl ProviderTrait,
) -> Result<PreLockParameters, PreLockTransactionError> {
    if tx.input.len() < 5 || tx.output.len() < 7 || !tx.output[5].is_null_data() {
        return Err(PreLockTransactionError::NotAPreLockCreationTx(tx.txid()));
    }

    let collateral_asset_id = tx.output[0]
        .asset
        .explicit()
        .ok_or_else(PreLockTransactionError::ConfidentialAssetsAreNotSupported)?;
    let first_parameters_nft_asset_id = tx.output[1]
        .asset
        .explicit()
        .expect("Utility NFT must be explicit");
    let second_parameters_nft_asset_id = tx.output[2]
        .asset
        .explicit()
        .expect("Utility NFT must be explicit");
    let borrower_nft_asset_id = tx.output[3]
        .asset
        .explicit()
        .expect("Utility NFT must be explicit");
    let lender_nft_asset_id = tx.output[4]
        .asset
        .explicit()
        .expect("Utility NFT must be explicit");

    let first_parameters_nft_amount = tx.output[1]
        .value
        .explicit()
        .expect("Parameter NFT must have explicit amount");
    let second_parameters_nft_amount = tx.output[2]
        .value
        .explicit()
        .expect("Parameter NFT must have explicit amount");

    let offer_parameters = LendingOfferParameters::build_from_parameters_nfts(
        &FirstNFTParameters::decode(first_parameters_nft_amount),
        &SecondNFTParameters::decode(second_parameters_nft_amount),
    );

    let prev_collateral_outpoint = tx.input[0].previous_output;
    let pre_collateral_tx = provider.fetch_transaction(&prev_collateral_outpoint.txid)?;
    let collateral_script_hash = hash_script(
        &pre_collateral_tx.output[prev_collateral_outpoint.vout as usize].script_pubkey,
    );

    let mut op_return_instr_iter = tx.output[5].script_pubkey.instructions_minimal();

    op_return_instr_iter.next();

    let op_return_bytes = op_return_instr_iter
        .next()
        .unwrap()
        .unwrap()
        .push_bytes()
        .unwrap();

    let (borrower_pubkey, principal_asset_id) =
        PreLock::decode_creation_op_return_data(op_return_bytes.to_vec())?;

    let pre_lock_parameters = PreLockParameters {
        collateral_asset_id,
        principal_asset_id,
        first_parameters_nft_asset_id,
        second_parameters_nft_asset_id,
        borrower_nft_asset_id,
        lender_nft_asset_id,
        offer_parameters,
        borrower_pubkey,
        borrower_output_script_hash: collateral_script_hash,
        network: *provider.get_network(),
    };

    Ok(pre_lock_parameters)
}
