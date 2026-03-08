use simplicity_contracts::sdk::validation::TxOutExt;
use simplicityhl::elements::Transaction;
use simplicityhl::elements::hex::ToHex;
use simplicityhl::elements::opcodes;
use simplicityhl::elements::schnorr::XOnlyPublicKey;
use simplicityhl::elements::script::Instruction;
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
use crate::sdk::pre_lock::metadata::decode_pre_lock_metadata;
use crate::sdk::taproot_unspendable_internal_key;

fn extract_null_data_bytes(
    script: &simplicityhl::elements::Script,
) -> Result<&[u8], TransactionBuildError> {
    let mut script_instr_iter = script.instructions_minimal();

    match script_instr_iter.next() {
        Some(Ok(Instruction::Op(opcodes::all::OP_RETURN))) => {}
        _ => {
            return Err(TransactionBuildError::PreLock(
                PreLockError::InvalidOpReturnBytes {
                    bytes: script.to_hex(),
                },
            ));
        }
    }

    match script_instr_iter.next() {
        Some(Ok(push_instruction)) => push_instruction.push_bytes().ok_or_else(|| {
            TransactionBuildError::PreLock(PreLockError::InvalidOpReturnBytes {
                bytes: script.to_hex(),
            })
        }),
        _ => Err(TransactionBuildError::PreLock(
            PreLockError::InvalidOpReturnBytes {
                bytes: script.to_hex(),
            },
        )),
    }
}

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
#[allow(clippy::too_many_lines)]
pub fn extract_arguments_from_tx(
    tx: &Transaction,
    network: SimplicityNetwork,
) -> Result<PreLockArguments, TransactionBuildError> {
    let not_a_pre_lock = || {
        TransactionBuildError::PreLock(PreLockError::NotAPreLockTransaction {
            txid: tx.txid().to_hex(),
        })
    };

    // Wallet ABI pre-lock creation can use 5 inputs when the collateral asset is the
    // policy asset and the same LBTC input covers both collateral and fees. Non-policy
    // collateral requires an additional LBTC fee input, so 6+ inputs remain valid too.
    if tx.input.len() < 5 || tx.output.len() < 7 {
        return Err(not_a_pre_lock());
    }

    let pre_lock_tx_out = tx.output.first().ok_or_else(not_a_pre_lock)?;
    let first_parameters_nft_tx_out = tx.output.get(1).ok_or_else(not_a_pre_lock)?;
    let second_parameters_nft_tx_out = tx.output.get(2).ok_or_else(not_a_pre_lock)?;
    let borrower_nft_tx_out = tx.output.get(3).ok_or_else(not_a_pre_lock)?;
    let lender_nft_tx_out = tx.output.get(4).ok_or_else(not_a_pre_lock)?;
    let op_return_tx_out = tx.output.get(5).ok_or_else(not_a_pre_lock)?;

    if !op_return_tx_out.is_null_data() {
        return Err(not_a_pre_lock());
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

    let op_return_bytes = extract_null_data_bytes(&op_return_tx_out.script_pubkey)?;
    let borrower_output_script_hash_bytes = tx
        .output
        .get(6)
        .filter(|tx_out| tx_out.is_null_data())
        .map(|tx_out| extract_null_data_bytes(&tx_out.script_pubkey))
        .transpose()?;

    let metadata = decode_pre_lock_metadata(op_return_bytes, borrower_output_script_hash_bytes)?;
    let principal_asset_id = metadata.principal_asset_id();
    let borrower_public_key =
        XOnlyPublicKey::from_slice(&metadata.borrower_pub_key()).map_err(|_| {
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

    let borrower_output_script_hash =
        if let Some(borrower_output_script_hash) = metadata.borrower_output_script_hash() {
            borrower_output_script_hash
        } else {
            let borrower_p2tr_address = get_p2pk_address(&borrower_public_key, network)?;
            hash_script(&borrower_p2tr_address.script_pubkey())
        };

    let pre_lock_arguments = PreLockArguments::new(
        pre_lock_asset_id.into_inner().0,
        principal_asset_id,
        borrower_nft_asset_id.into_inner().0,
        lender_nft_asset_id.into_inner().0,
        first_parameters_nft_asset_id.into_inner().0,
        second_parameters_nft_asset_id.into_inner().0,
        lending_cov_hash,
        parameters_nft_output_script_hash,
        borrower_output_script_hash,
        borrower_output_script_hash,
        borrower_public_key.serialize(),
        &lending_params,
    );

    Ok(pre_lock_arguments)
}

#[cfg(test)]
mod tests {
    use super::*;
    use simplicityhl::elements::AssetId;
    use simplicityhl::elements::LockTime;
    use simplicityhl::elements::OutPoint;
    use simplicityhl::elements::Script;
    use simplicityhl::elements::Sequence;
    use simplicityhl::elements::TxIn;
    use simplicityhl::elements::TxOut;
    use simplicityhl::elements::TxOutWitness;
    use simplicityhl::elements::confidential::{Asset, Nonce, Value};

    fn explicit_tx_out(asset_id: AssetId, amount: u64, script_pubkey: Script) -> TxOut {
        TxOut {
            asset: Asset::Explicit(asset_id),
            value: Value::Explicit(amount),
            nonce: Nonce::Null,
            script_pubkey,
            witness: TxOutWitness::default(),
        }
    }

    #[test]
    fn rejects_short_op_return_metadata_without_panicking() {
        let asset_id = AssetId::default();
        let tx = Transaction {
            version: 2,
            lock_time: LockTime::ZERO,
            input: vec![
                TxIn {
                    previous_output: OutPoint::default(),
                    is_pegin: false,
                    script_sig: Script::new(),
                    sequence: Sequence::MAX,
                    asset_issuance: simplicityhl::elements::AssetIssuance::default(),
                    witness: simplicityhl::elements::TxInWitness::default(),
                };
                6
            ],
            output: vec![
                explicit_tx_out(asset_id, 10, Script::new()),
                explicit_tx_out(asset_id, 11, Script::new()),
                explicit_tx_out(asset_id, 12, Script::new()),
                explicit_tx_out(asset_id, 1, Script::new()),
                explicit_tx_out(asset_id, 1, Script::new()),
                explicit_tx_out(asset_id, 0, Script::new_op_return(&[1u8; 31])),
                explicit_tx_out(asset_id, 1, Script::new()),
            ],
        };

        let error = extract_arguments_from_tx(&tx, SimplicityNetwork::LiquidTestnet)
            .expect_err("short OP_RETURN metadata should be rejected");

        match error {
            TransactionBuildError::PreLock(PreLockError::InvalidOpReturnBytes { .. }) => {}
            other => panic!("unexpected error: {other:?}"),
        }
    }
}
