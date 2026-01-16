use std::sync::Arc;

use simplicityhl_core::{
    ProgramError, control_block, create_p2tr_address, get_and_verify_env, load_program, run_program,
};

use simplicityhl::elements::{self, Address, AddressParams, Transaction, TxInWitness, TxOut};

use simplicityhl::simplicity::RedeemNode;
use simplicityhl::simplicity::jet::Elements;
use simplicityhl::simplicity::{bitcoin::XOnlyPublicKey, jet::elements::ElementsEnv};

use simplicityhl::tracker::TrackerLogLevel;
use simplicityhl::{CompiledProgram, TemplateProgram};

pub mod build_arguments;
pub mod build_witness;

use build_arguments::PreLockArguments;

use crate::pre_lock::build_witness::{PreLockBranch, build_pre_lock_witness};

pub const PRE_LOCK_SOURCE: &str = include_str!("source_simf/pre_lock.simf");

pub fn get_pre_lock_template_program() -> TemplateProgram {
    TemplateProgram::new(PRE_LOCK_SOURCE)
        .expect("INTERNAL: expected Pre Lock Program to compile successfully.")
}

pub fn get_pre_lock_address(
    x_only_public_key: &XOnlyPublicKey,
    arguments: &PreLockArguments,
    params: &'static AddressParams,
) -> Result<Address, ProgramError> {
    Ok(create_p2tr_address(
        get_pre_lock_program(arguments)?.commit().cmr(),
        x_only_public_key,
        params,
    ))
}

pub fn get_pre_lock_program(arguments: &PreLockArguments) -> Result<CompiledProgram, ProgramError> {
    load_program(PRE_LOCK_SOURCE, arguments.build_pre_lock_arguments())
}

pub fn get_compiled_pre_lock_program(arguments: &PreLockArguments) -> CompiledProgram {
    let program = get_pre_lock_template_program();

    program
        .instantiate(arguments.build_pre_lock_arguments(), true)
        .unwrap()
}

pub fn execute_pre_lock_program(
    compiled_program: &CompiledProgram,
    env: &ElementsEnv<Arc<Transaction>>,
    pre_lock_branch: PreLockBranch,
    runner_log_level: TrackerLogLevel,
) -> Result<Arc<RedeemNode<Elements>>, ProgramError> {
    let witness_values = build_pre_lock_witness(pre_lock_branch);

    Ok(run_program(compiled_program, witness_values, env, runner_log_level)?.0)
}

#[allow(clippy::too_many_arguments)]
pub fn finalize_pre_lock_transaction(
    mut tx: Transaction,
    options_public_key: &XOnlyPublicKey,
    options_program: &CompiledProgram,
    utxos: &[TxOut],
    input_index: usize,
    pre_lock_branch: PreLockBranch,
    params: &'static AddressParams,
    genesis_hash: elements::BlockHash,
) -> Result<Transaction, ProgramError> {
    let env = get_and_verify_env(
        &tx,
        options_program,
        options_public_key,
        utxos,
        params,
        genesis_hash,
        input_index,
    )?;

    let pruned = execute_pre_lock_program(
        options_program,
        &env,
        pre_lock_branch,
        TrackerLogLevel::None,
    )?;

    let (simplicity_program_bytes, simplicity_witness_bytes) = pruned.to_vec_with_witness();
    let cmr = pruned.cmr();

    tx.input[input_index].witness = TxInWitness {
        amount_rangeproof: None,
        inflation_keys_rangeproof: None,
        script_witness: vec![
            simplicity_witness_bytes,
            simplicity_program_bytes,
            cmr.as_ref().to_vec(),
            control_block(cmr, *options_public_key).serialize(),
        ],
        pegin_witness: vec![],
    };

    Ok(tx)
}

#[cfg(test)]
mod lending_tests {
    use crate::asset_auth::build_arguments::AssetAuthArguments;
    use crate::asset_auth::get_asset_auth_address;
    use crate::lending::build_arguments::LendingArguments;
    use crate::lending::get_lending_address;
    use crate::script_auth::build_arguments::ScriptAuthArguments;
    use crate::script_auth::get_script_auth_address;
    use crate::sdk::parameters::{
        FirstNFTParameters, LendingParameters, SecondNFTParameters, to_base_amount,
    };
    use crate::sdk::{
        build_pre_lock_cancellation, build_pre_lock_creation, build_pre_lock_lending_creation,
        taproot_unspendable_internal_key,
    };

    use super::*;

    use anyhow::{Ok, Result};
    use simplicityhl::elements::bitcoin::secp256k1;
    use simplicityhl::elements::confidential::{Asset, Value};
    use simplicityhl::elements::schnorr::Keypair;
    use simplicityhl::elements::secp256k1_zkp::Secp256k1;
    use simplicityhl::elements::taproot::ControlBlock;
    use simplicityhl::simplicity::elements::{self, AssetId, OutPoint};
    use simplicityhl::simplicity::hashes::Hash;
    use simplicityhl::simplicity::jet::elements::ElementsUtxo;
    use std::str::FromStr;

    use simplicity_contracts::sdk::taproot_pubkey_gen::TaprootPubkeyGen;

    use simplicityhl::elements::pset::PartiallySignedTransaction;
    use simplicityhl::elements::{PubkeyHash, Script, Txid};
    use simplicityhl_core::{
        LIQUID_TESTNET_BITCOIN_ASSET, LIQUID_TESTNET_TEST_ASSET_ID_STR, get_new_asset_entropy,
        hash_script,
    };

    fn get_creation_pst(
        collateral_asset_id: AssetId,
        principal_asset_id: AssetId,
        first_parameters_nft_asset_id: AssetId,
        second_parameters_nft_asset_id: AssetId,
        borrower_nft_asset_id: AssetId,
        lender_nft_asset_id: AssetId,
        first_parameters_nft_amount: u64,
        second_parameters_nft_amount: u64,
        borrower_pub_key: &XOnlyPublicKey,
        lending_params: &LendingParameters,
    ) -> Result<(
        (PartiallySignedTransaction, TaprootPubkeyGen),
        PreLockArguments,
    )> {
        // Calculate script hash for the AssetAuth covenant with the Lender NFT auth
        let asset_auth_arguments = AssetAuthArguments {
            asset_id: lender_nft_asset_id.into_inner().0,
            asset_amount: 1,
            with_asset_burn: true,
        };
        let lender_principal_script = get_asset_auth_address(
            &taproot_unspendable_internal_key(),
            &asset_auth_arguments,
            &AddressParams::LIQUID_TESTNET,
        )?
        .script_pubkey();
        let principal_auth_script_hash = hash_script(&lender_principal_script);

        // Calculate Lending covenant script hash
        let lending_arguments = LendingArguments::new(
            collateral_asset_id.into_inner().0,
            principal_asset_id.into_inner().0,
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
            &AddressParams::LIQUID_TESTNET,
        )?
        .script_pubkey();
        let lending_cov_hash = hash_script(&lending_script);

        // Calculate ScriptAuth covenant script hash for the parameters nft
        let script_auth_arguments = ScriptAuthArguments::new(lending_cov_hash);
        let script_auth_script = get_script_auth_address(
            &taproot_unspendable_internal_key(),
            &script_auth_arguments,
            &AddressParams::LIQUID_TESTNET,
        )?
        .script_pubkey();
        let parameters_nft_output_script_hash = hash_script(&script_auth_script);

        // Calculate P2PKH script hash with the borrower public key
        let borrower_p2pkh_script =
            Script::new_p2pkh(&PubkeyHash::hash(&borrower_pub_key.serialize()));
        let borrower_p2pkh_script_hash = hash_script(&borrower_p2pkh_script);

        let pre_lock_arguments = PreLockArguments::new(
            collateral_asset_id.into_inner().0,
            principal_asset_id.into_inner().0,
            borrower_nft_asset_id.into_inner().0,
            lender_nft_asset_id.into_inner().0,
            first_parameters_nft_asset_id.into_inner().0,
            second_parameters_nft_asset_id.into_inner().0,
            lending_cov_hash,
            parameters_nft_output_script_hash,
            borrower_p2pkh_script_hash,
            borrower_p2pkh_script_hash,
            borrower_pub_key.serialize(),
            lending_params,
        );

        Ok((
            build_pre_lock_creation(
                (
                    OutPoint::default(),
                    TxOut {
                        asset: Asset::Explicit(collateral_asset_id),
                        value: Value::Explicit(lending_params.collateral_amount),
                        nonce: elements::confidential::Nonce::Null,
                        script_pubkey: Script::new(),
                        witness: elements::TxOutWitness::default(),
                    },
                ),
                (
                    OutPoint::default(),
                    TxOut {
                        asset: Asset::Explicit(first_parameters_nft_asset_id),
                        value: Value::Explicit(first_parameters_nft_amount),
                        nonce: elements::confidential::Nonce::Null,
                        script_pubkey: Script::new(),
                        witness: elements::TxOutWitness::default(),
                    },
                ),
                (
                    OutPoint::default(),
                    TxOut {
                        asset: Asset::Explicit(second_parameters_nft_asset_id),
                        value: Value::Explicit(second_parameters_nft_amount),
                        nonce: elements::confidential::Nonce::Null,
                        script_pubkey: Script::new(),
                        witness: elements::TxOutWitness::default(),
                    },
                ),
                (
                    OutPoint::default(),
                    TxOut {
                        asset: Asset::Explicit(borrower_nft_asset_id),
                        value: Value::Explicit(1),
                        nonce: elements::confidential::Nonce::Null,
                        script_pubkey: Script::new(),
                        witness: elements::TxOutWitness::default(),
                    },
                ),
                (
                    OutPoint::default(),
                    TxOut {
                        asset: Asset::Explicit(lender_nft_asset_id),
                        value: Value::Explicit(1),
                        nonce: elements::confidential::Nonce::Null,
                        script_pubkey: Script::new(),
                        witness: elements::TxOutWitness::default(),
                    },
                ),
                (
                    OutPoint::default(),
                    TxOut {
                        asset: Asset::Explicit(*LIQUID_TESTNET_BITCOIN_ASSET),
                        value: Value::Explicit(100),
                        nonce: elements::confidential::Nonce::Null,
                        script_pubkey: Script::new(),
                        witness: elements::TxOutWitness::default(),
                    },
                ),
                &pre_lock_arguments,
                100,
                &AddressParams::LIQUID_TESTNET,
            )?,
            pre_lock_arguments,
        ))
    }

    fn create_test_assets() -> Result<(AssetId, AssetId, AssetId, AssetId)> {
        let outpoint = OutPoint::new(Txid::from_slice(&[2; 32])?, 33);

        let first_asset_entropy = get_new_asset_entropy(&outpoint, [1; 32]);
        let second_asset_entropy = get_new_asset_entropy(&outpoint, [2; 32]);
        let third_asset_entropy = get_new_asset_entropy(&outpoint, [3; 32]);
        let fourth_asset_entropy = get_new_asset_entropy(&outpoint, [4; 32]);

        let first_parameters_nft_asset_id = AssetId::from_entropy(first_asset_entropy);
        let second_parameters_nft_asset_id = AssetId::from_entropy(second_asset_entropy);
        let borrower_nft_asset_id = AssetId::from_entropy(third_asset_entropy);
        let lender_nft_asset_id = AssetId::from_entropy(fourth_asset_entropy);

        Ok((
            first_parameters_nft_asset_id,
            second_parameters_nft_asset_id,
            borrower_nft_asset_id,
            lender_nft_asset_id,
        ))
    }

    fn encode_parameters_amounts(
        lending_params: &LendingParameters,
        amounts_decimals: u8,
    ) -> Result<(u64, u64)> {
        let first_parameters_nft_encoded_amount = FirstNFTParameters::encode(
            lending_params.principal_interest_rate,
            lending_params.loan_expiration_time,
            amounts_decimals,
            amounts_decimals,
        )
        .expect("Failed to encode first parameters nft amount");
        let second_parameters_nft_encoded_amount = SecondNFTParameters::encode(
            to_base_amount(lending_params.collateral_amount, amounts_decimals),
            to_base_amount(lending_params.principal_amount, amounts_decimals),
        )
        .expect("Failed to encode second parameters nft amount");

        Ok((
            first_parameters_nft_encoded_amount,
            second_parameters_nft_encoded_amount,
        ))
    }

    #[test]
    fn test_pre_lock_creation() -> Result<()> {
        let keypair = Keypair::from_secret_key(
            &Secp256k1::new(),
            &secp256k1::SecretKey::from_slice(&[1u8; 32])?,
        );
        let test_borrower_key = keypair.x_only_public_key().0;

        let (
            first_parameters_nft_asset_id,
            second_parameters_nft_asset_id,
            borrower_nft_asset_id,
            lender_nft_asset_id,
        ) = create_test_assets()?;

        let amounts_decimals = 2;
        let lending_params = LendingParameters {
            collateral_amount: 10000,
            principal_amount: 4000,
            loan_expiration_time: 100,
            principal_interest_rate: 250, // 2.5%
        };
        let (first_parameters_amount, second_parameters_amount) =
            encode_parameters_amounts(&lending_params, amounts_decimals)?;

        let ((pst, _), _) = get_creation_pst(
            *LIQUID_TESTNET_BITCOIN_ASSET,
            AssetId::from_str(LIQUID_TESTNET_TEST_ASSET_ID_STR)?,
            first_parameters_nft_asset_id,
            second_parameters_nft_asset_id,
            borrower_nft_asset_id,
            lender_nft_asset_id,
            first_parameters_amount,
            second_parameters_amount,
            &test_borrower_key,
            &lending_params,
        )?;

        let pst = pst.extract_tx()?;

        // Check Borrower PK from the OP_RETURN output
        assert!(pst.output[5].is_null_data());

        let op_return_data = pst.output[5].script_pubkey.clone();

        let mut op_return_instr_iter = op_return_data.instructions_minimal().into_iter();

        op_return_instr_iter.next();

        let op_return_bytes = op_return_instr_iter
            .next()
            .unwrap()
            .unwrap()
            .push_bytes()
            .unwrap();
        let op_return_public_key = XOnlyPublicKey::from_slice(op_return_bytes).unwrap();

        assert!(op_return_public_key.serialize() == test_borrower_key.serialize());

        Ok(())
    }

    #[test]
    fn test_pre_lock_cancellation() -> Result<()> {
        let keypair = Keypair::from_secret_key(
            &Secp256k1::new(),
            &secp256k1::SecretKey::from_slice(&[1u8; 32])?,
        );
        let test_borrower_key = keypair.x_only_public_key().0;

        let (
            first_parameters_nft_asset_id,
            second_parameters_nft_asset_id,
            borrower_nft_asset_id,
            lender_nft_asset_id,
        ) = create_test_assets()?;

        let amounts_decimals = 2;
        let lending_params = LendingParameters {
            collateral_amount: 10000,
            principal_amount: 4000,
            loan_expiration_time: 100,
            principal_interest_rate: 250, // 2.5%
        };
        let (first_parameters_amount, second_parameters_amount) =
            encode_parameters_amounts(&lending_params, amounts_decimals)?;

        let ((pst, pre_lock_pubkey_gen), pre_lock_arguments) = get_creation_pst(
            *LIQUID_TESTNET_BITCOIN_ASSET,
            AssetId::from_str(LIQUID_TESTNET_TEST_ASSET_ID_STR)?,
            first_parameters_nft_asset_id,
            second_parameters_nft_asset_id,
            borrower_nft_asset_id,
            lender_nft_asset_id,
            first_parameters_amount,
            second_parameters_amount,
            &test_borrower_key,
            &lending_params,
        )?;

        let pst = pst.extract_tx()?;

        let pre_lock_tx_out = pst.output[0].clone();

        let collateral_output_script =
            Script::new_p2pkh(&PubkeyHash::hash(&test_borrower_key.serialize()));

        let pst = build_pre_lock_cancellation(
            (OutPoint::default(), pre_lock_tx_out),
            (
                OutPoint::default(),
                TxOut {
                    asset: Asset::Explicit(first_parameters_nft_asset_id),
                    value: Value::Explicit(first_parameters_amount),
                    nonce: elements::confidential::Nonce::Null,
                    script_pubkey: Script::new(),
                    witness: elements::TxOutWitness::default(),
                },
            ),
            (
                OutPoint::default(),
                TxOut {
                    asset: Asset::Explicit(second_parameters_nft_asset_id),
                    value: Value::Explicit(second_parameters_amount),
                    nonce: elements::confidential::Nonce::Null,
                    script_pubkey: Script::new(),
                    witness: elements::TxOutWitness::default(),
                },
            ),
            (
                OutPoint::default(),
                TxOut {
                    asset: Asset::Explicit(borrower_nft_asset_id),
                    value: Value::Explicit(1),
                    nonce: elements::confidential::Nonce::Null,
                    script_pubkey: Script::new(),
                    witness: elements::TxOutWitness::default(),
                },
            ),
            (
                OutPoint::default(),
                TxOut {
                    asset: Asset::Explicit(lender_nft_asset_id),
                    value: Value::Explicit(1),
                    nonce: elements::confidential::Nonce::Null,
                    script_pubkey: Script::new(),
                    witness: elements::TxOutWitness::default(),
                },
            ),
            (
                OutPoint::default(),
                TxOut {
                    asset: Asset::Explicit(*LIQUID_TESTNET_BITCOIN_ASSET),
                    value: Value::Explicit(100),
                    nonce: elements::confidential::Nonce::Null,
                    script_pubkey: Script::new(),
                    witness: elements::TxOutWitness::default(),
                },
            ),
            &pre_lock_arguments,
            &collateral_output_script,
            100,
        )?;

        let program = get_compiled_pre_lock_program(&pre_lock_arguments);

        let env = ElementsEnv::new(
            Arc::new(pst.extract_tx()?),
            vec![
                ElementsUtxo {
                    script_pubkey: pre_lock_pubkey_gen.address.script_pubkey(),
                    asset: Asset::Explicit(*LIQUID_TESTNET_BITCOIN_ASSET),
                    value: Value::Explicit(lending_params.collateral_amount),
                },
                ElementsUtxo {
                    script_pubkey: Script::new(),
                    asset: Asset::Explicit(first_parameters_nft_asset_id),
                    value: Value::Explicit(first_parameters_amount),
                },
                ElementsUtxo {
                    script_pubkey: Script::new(),
                    asset: Asset::Explicit(second_parameters_nft_asset_id),
                    value: Value::Explicit(second_parameters_amount),
                },
                ElementsUtxo {
                    script_pubkey: Script::new(),
                    asset: Asset::Explicit(borrower_nft_asset_id),
                    value: Value::Explicit(1),
                },
                ElementsUtxo {
                    script_pubkey: Script::new(),
                    asset: Asset::Explicit(lender_nft_asset_id),
                    value: Value::Explicit(1),
                },
                ElementsUtxo {
                    script_pubkey: Script::new(),
                    asset: Asset::Explicit(*LIQUID_TESTNET_BITCOIN_ASSET),
                    value: Value::Explicit(100),
                },
            ],
            0,
            simplicityhl::simplicity::Cmr::from_byte_array([0; 32]),
            ControlBlock::from_slice(&[0xc0; 33])?,
            None,
            elements::BlockHash::all_zeros(),
        );

        let sighash_all = env.c_tx_env().sighash_all();
        let signature =
            keypair.sign_schnorr(secp256k1::Message::from_digest(sighash_all.to_byte_array()));

        let witness_values = build_pre_lock_witness(PreLockBranch::PreLockCancellation {
            cancellation_signature: &signature,
        });

        assert!(
            run_program(&program, witness_values, &env, TrackerLogLevel::Trace).is_ok(),
            "expected success cancellation path"
        );

        let pst = pst.extract_tx()?;

        assert!(pst.output[0].script_pubkey == collateral_output_script);
        assert!(pst.output[1].is_null_data());
        assert!(pst.output[2].is_null_data());
        assert!(pst.output[3].is_null_data());
        assert!(pst.output[4].is_null_data());

        Ok(())
    }

    #[test]
    fn test_pre_lock_lending_creation() -> Result<()> {
        let secp = &Secp256k1::new();
        let borrower_keypair =
            Keypair::from_secret_key(secp, &secp256k1::SecretKey::from_slice(&[1u8; 32])?);
        let lender_keypair =
            Keypair::from_secret_key(secp, &secp256k1::SecretKey::from_slice(&[2u8; 32])?);
        let test_borrower_key = borrower_keypair.x_only_public_key().0;
        let test_lender_key = lender_keypair.x_only_public_key().0;

        let principal_asset_id = AssetId::from_str(LIQUID_TESTNET_TEST_ASSET_ID_STR)?;
        let (
            first_parameters_nft_asset_id,
            second_parameters_nft_asset_id,
            borrower_nft_asset_id,
            lender_nft_asset_id,
        ) = create_test_assets()?;

        let amounts_decimals = 2;
        let lending_params = LendingParameters {
            collateral_amount: 10000,
            principal_amount: 4000,
            loan_expiration_time: 100,
            principal_interest_rate: 250, // 2.5%
        };
        let (first_parameters_amount, second_parameters_amount) =
            encode_parameters_amounts(&lending_params, amounts_decimals)?;

        let ((pst, pre_lock_pubkey_gen), pre_lock_arguments) = get_creation_pst(
            *LIQUID_TESTNET_BITCOIN_ASSET,
            principal_asset_id,
            first_parameters_nft_asset_id,
            second_parameters_nft_asset_id,
            borrower_nft_asset_id,
            lender_nft_asset_id,
            first_parameters_amount,
            second_parameters_amount,
            &test_borrower_key,
            &lending_params,
        )?;

        let pst = pst.extract_tx()?;

        let pre_lock_tx_out = pst.output[0].clone();

        let lender_nft_output_script =
            Script::new_p2pkh(&PubkeyHash::hash(&test_lender_key.serialize()));

        let pst = build_pre_lock_lending_creation(
            (OutPoint::default(), pre_lock_tx_out),
            (
                OutPoint::default(),
                TxOut {
                    asset: Asset::Explicit(principal_asset_id),
                    value: Value::Explicit(lending_params.principal_amount),
                    nonce: elements::confidential::Nonce::Null,
                    script_pubkey: Script::new(),
                    witness: elements::TxOutWitness::default(),
                },
            ),
            (
                OutPoint::default(),
                TxOut {
                    asset: Asset::Explicit(first_parameters_nft_asset_id),
                    value: Value::Explicit(first_parameters_amount),
                    nonce: elements::confidential::Nonce::Null,
                    script_pubkey: Script::new(),
                    witness: elements::TxOutWitness::default(),
                },
            ),
            (
                OutPoint::default(),
                TxOut {
                    asset: Asset::Explicit(second_parameters_nft_asset_id),
                    value: Value::Explicit(second_parameters_amount),
                    nonce: elements::confidential::Nonce::Null,
                    script_pubkey: Script::new(),
                    witness: elements::TxOutWitness::default(),
                },
            ),
            (
                OutPoint::default(),
                TxOut {
                    asset: Asset::Explicit(borrower_nft_asset_id),
                    value: Value::Explicit(1),
                    nonce: elements::confidential::Nonce::Null,
                    script_pubkey: Script::new(),
                    witness: elements::TxOutWitness::default(),
                },
            ),
            (
                OutPoint::default(),
                TxOut {
                    asset: Asset::Explicit(lender_nft_asset_id),
                    value: Value::Explicit(1),
                    nonce: elements::confidential::Nonce::Null,
                    script_pubkey: Script::new(),
                    witness: elements::TxOutWitness::default(),
                },
            ),
            (
                OutPoint::default(),
                TxOut {
                    asset: Asset::Explicit(*LIQUID_TESTNET_BITCOIN_ASSET),
                    value: Value::Explicit(100),
                    nonce: elements::confidential::Nonce::Null,
                    script_pubkey: Script::new(),
                    witness: elements::TxOutWitness::default(),
                },
            ),
            &pre_lock_arguments,
            &lender_nft_output_script,
            100,
            &AddressParams::LIQUID_TESTNET,
        )?;

        let program = get_compiled_pre_lock_program(&pre_lock_arguments);

        let env = ElementsEnv::new(
            Arc::new(pst.extract_tx()?),
            vec![
                ElementsUtxo {
                    script_pubkey: pre_lock_pubkey_gen.address.script_pubkey(),
                    asset: Asset::Explicit(*LIQUID_TESTNET_BITCOIN_ASSET),
                    value: Value::Explicit(lending_params.collateral_amount),
                },
                ElementsUtxo {
                    script_pubkey: Script::new(),
                    asset: Asset::Explicit(first_parameters_nft_asset_id),
                    value: Value::Explicit(first_parameters_amount),
                },
                ElementsUtxo {
                    script_pubkey: Script::new(),
                    asset: Asset::Explicit(second_parameters_nft_asset_id),
                    value: Value::Explicit(second_parameters_amount),
                },
                ElementsUtxo {
                    script_pubkey: Script::new(),
                    asset: Asset::Explicit(borrower_nft_asset_id),
                    value: Value::Explicit(1),
                },
                ElementsUtxo {
                    script_pubkey: Script::new(),
                    asset: Asset::Explicit(lender_nft_asset_id),
                    value: Value::Explicit(1),
                },
                ElementsUtxo {
                    script_pubkey: Script::new(),
                    asset: Asset::Explicit(principal_asset_id),
                    value: Value::Explicit(lending_params.principal_amount),
                },
                ElementsUtxo {
                    script_pubkey: Script::new(),
                    asset: Asset::Explicit(*LIQUID_TESTNET_BITCOIN_ASSET),
                    value: Value::Explicit(100),
                },
            ],
            0,
            simplicityhl::simplicity::Cmr::from_byte_array([0; 32]),
            ControlBlock::from_slice(&[0xc0; 33])?,
            None,
            elements::BlockHash::all_zeros(),
        );

        let witness_values = build_pre_lock_witness(PreLockBranch::LendingCreation);

        assert!(
            run_program(&program, witness_values, &env, TrackerLogLevel::Trace).is_ok(),
            "expected success lending creation path"
        );

        Ok(())
    }
}
