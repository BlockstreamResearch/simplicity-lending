use simplicity_contracts::sdk::validation::TxOutExt;
use simplicityhl::elements::Transaction;
use simplicityhl::elements::hex::ToHex;
use simplicityhl::elements::schnorr::XOnlyPublicKey;
use simplicityhl_core::{SimplicityNetwork, get_p2pk_address, hash_script};

use crate::asset_auth::build_arguments::AssetAuthArguments;
use crate::asset_auth::get_asset_auth_address;
use crate::error::{PreLockError, TransactionBuildError};
use crate::lending::build_arguments::LendingArguments;
use crate::lending::get_lending_address;
use crate::pre_lock::build_arguments::PreLockArguments;
use crate::script_auth::build_arguments::ScriptAuthArguments;
use crate::script_auth::get_script_auth_address;
use crate::sdk::parameters::{FirstNFTParameters, LendingParameters, SecondNFTParameters};
use crate::sdk::taproot_unspendable_internal_key;

/// Extract a pre lock arguments from the pre lock creation transaction
///
/// # Errors
///
/// Returns an error if:
/// - The UTXO values are not explicit
/// - The parameters NFT decode fails
/// - Passed UTXOs asset ids and values differ from the arguments
/// - Covenants addresses getting fails
///
/// # Panics
///
/// - if `OP_RETURN` UTXO has invalid bytes
#[allow(clippy::too_many_lines)]
pub fn extract_arguments_from_tx(
    tx: &Transaction,
    network: SimplicityNetwork,
) -> Result<PreLockArguments, TransactionBuildError> {
    if tx.input.len() < 6 || tx.output.len() < 7 {
        return Err(TransactionBuildError::PreLock(
            PreLockError::NotAPreLockTransaction {
                txid: tx.txid().to_hex(),
            },
        ));
    }

    // Unwrap is safe here because we have already checked outputs length
    let pre_lock_tx_out = tx.output.first().unwrap();
    let first_parameters_nft_tx_out = tx.output.get(1).unwrap();
    let second_parameters_nft_tx_out = tx.output.get(2).unwrap();
    let borrower_nft_tx_out = tx.output.get(3).unwrap();
    let lender_nft_tx_out = tx.output.get(4).unwrap();
    let op_return_tx_out = tx.output.get(5).unwrap();

    if !op_return_tx_out.is_null_data() {
        return Err(TransactionBuildError::PreLock(
            PreLockError::NotAPreLockTransaction {
                txid: tx.txid().to_hex(),
            },
        ));
    }

    let (pre_lock_asset_id, _) = pre_lock_tx_out.explicit()?;
    let (first_parameters_nft_asset_id, first_parameters_nft_value) =
        first_parameters_nft_tx_out.explicit()?;
    let (second_parameters_nft_asset_id, second_parameters_nft_value) =
        second_parameters_nft_tx_out.explicit()?;
    let (borrower_nft_asset_id, _) = borrower_nft_tx_out.explicit()?;
    let (lender_nft_asset_id, _) = lender_nft_tx_out.explicit()?;

    let first_parameters = FirstNFTParameters::decode(first_parameters_nft_value);
    let second_parameters = SecondNFTParameters::decode(second_parameters_nft_value);

    let lending_params =
        LendingParameters::build_from_parameters_nfts(&first_parameters, &second_parameters);

    let mut op_return_instr_iter = op_return_tx_out.script_pubkey.instructions_minimal();

    op_return_instr_iter.next();

    let op_return_bytes = op_return_instr_iter
        .next()
        .unwrap()
        .unwrap()
        .push_bytes()
        .unwrap();

    let (op_return_pub_key, op_return_asset_id) = op_return_bytes.split_at(32);

    let principal_asset_id: [u8; 32] =
        op_return_asset_id
            .try_into()
            .map_err(|_| PreLockError::InvalidOpReturnBytes {
                bytes: op_return_bytes.to_hex(),
            })?;

    let borrower_public_key = XOnlyPublicKey::from_slice(op_return_pub_key).map_err(|_| {
        PreLockError::InvalidOpReturnBytes {
            bytes: op_return_bytes.to_hex(),
        }
    })?;

    // Calculate script hash for the AssetAuth covenant with the Lender NFT auth
    let asset_auth_arguments = AssetAuthArguments {
        asset_id: lender_nft_asset_id.into_inner().0,
        asset_amount: 1,
        with_asset_burn: true,
    };
    let lender_principal_script = get_asset_auth_address(
        &taproot_unspendable_internal_key(),
        &asset_auth_arguments,
        network,
    )?
    .script_pubkey();
    let principal_auth_script_hash = hash_script(&lender_principal_script);

    // Calculate Lending covenant script hash
    let lending_arguments = LendingArguments::new(
        pre_lock_asset_id.into_inner().0,
        principal_asset_id,
        borrower_nft_asset_id.into_inner().0,
        lender_nft_asset_id.into_inner().0,
        first_parameters_nft_asset_id.into_inner().0,
        second_parameters_nft_asset_id.into_inner().0,
        principal_auth_script_hash,
        &lending_params,
    );
    let lending_script = get_lending_address(
        &taproot_unspendable_internal_key(),
        &lending_arguments,
        network,
    )?
    .script_pubkey();
    let lending_cov_hash = hash_script(&lending_script);

    // Calculate ScriptAuth covenant script hash for the parameters nft
    let script_auth_arguments = ScriptAuthArguments::new(lending_cov_hash);
    let script_auth_script = get_script_auth_address(
        &taproot_unspendable_internal_key(),
        &script_auth_arguments,
        network,
    )?
    .script_pubkey();
    let parameters_nft_output_script_hash = hash_script(&script_auth_script);

    // Calculate P2TR script hash
    let borrower_p2tr_address = get_p2pk_address(&borrower_public_key, network)?;
    let borrower_p2tr_script_hash = hash_script(&borrower_p2tr_address.script_pubkey());

    let pre_lock_arguments = PreLockArguments::new(
        pre_lock_asset_id.into_inner().0,
        principal_asset_id,
        borrower_nft_asset_id.into_inner().0,
        lender_nft_asset_id.into_inner().0,
        first_parameters_nft_asset_id.into_inner().0,
        second_parameters_nft_asset_id.into_inner().0,
        lending_cov_hash,
        parameters_nft_output_script_hash,
        borrower_p2tr_script_hash,
        borrower_p2tr_script_hash,
        borrower_public_key.serialize(),
        &lending_params,
    );

    Ok(pre_lock_arguments)
}
