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

use build_arguments::ScriptAuthArguments;

use crate::script_auth::build_witness::{ScriptAuthWitnessParams, build_script_auth_witness};

pub const SCRIPT_AUTH_SOURCE: &str = include_str!("source_simf/script_auth.simf");

pub fn get_script_auth_template_program() -> TemplateProgram {
    TemplateProgram::new(SCRIPT_AUTH_SOURCE)
        .expect("INTERNAL: expected Asset Auth Program to compile successfully.")
}

pub fn get_script_auth_address(
    x_only_public_key: &XOnlyPublicKey,
    arguments: &ScriptAuthArguments,
    params: &'static AddressParams,
) -> Result<Address, ProgramError> {
    Ok(create_p2tr_address(
        get_script_auth_program(arguments)?.commit().cmr(),
        x_only_public_key,
        params,
    ))
}

pub fn get_script_auth_program(
    arguments: &ScriptAuthArguments,
) -> Result<CompiledProgram, ProgramError> {
    load_program(SCRIPT_AUTH_SOURCE, arguments.build_script_auth_arguments())
}

pub fn get_compiled_script_auth_program(arguments: &ScriptAuthArguments) -> CompiledProgram {
    let program = get_script_auth_template_program();

    program
        .instantiate(arguments.build_script_auth_arguments(), true)
        .unwrap()
}

pub fn execute_script_auth_program(
    compiled_program: &CompiledProgram,
    env: &ElementsEnv<Arc<Transaction>>,
    witness_params: &ScriptAuthWitnessParams,
    runner_log_level: TrackerLogLevel,
) -> Result<Arc<RedeemNode<Elements>>, ProgramError> {
    let witness_values = build_script_auth_witness(witness_params);

    Ok(run_program(compiled_program, witness_values, env, runner_log_level)?.0)
}

#[allow(clippy::too_many_arguments)]
pub fn finalize_script_auth_transaction(
    mut tx: Transaction,
    options_public_key: &XOnlyPublicKey,
    options_program: &CompiledProgram,
    utxos: &[TxOut],
    input_index: usize,
    witness_params: &ScriptAuthWitnessParams,
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

    let pruned =
        execute_script_auth_program(options_program, &env, witness_params, TrackerLogLevel::None)?;

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
mod script_auth_tests {
    use crate::sdk::{build_script_auth_creation, build_script_auth_unlock};

    use super::*;

    use anyhow::{Ok, Result};
    use simplicityhl::elements::bitcoin::PublicKey;
    use simplicityhl::elements::confidential::{Asset, Value};
    use simplicityhl::simplicity::bitcoin::key::Keypair;
    use simplicityhl::simplicity::bitcoin::secp256k1;
    use simplicityhl::simplicity::bitcoin::secp256k1::Secp256k1;
    use simplicityhl::simplicity::elements::{self, AssetId, OutPoint};
    use simplicityhl::simplicity::hashes::Hash;
    use std::str::FromStr;

    use simplicity_contracts::sdk::taproot_pubkey_gen::TaprootPubkeyGen;

    use simplicityhl::elements::Script;
    use simplicityhl::elements::pset::PartiallySignedTransaction;
    use simplicityhl::elements::taproot::ControlBlock;
    use simplicityhl::simplicity::jet::elements::ElementsUtxo;
    use simplicityhl_core::{
        LIQUID_TESTNET_BITCOIN_ASSET, LIQUID_TESTNET_TEST_ASSET_ID_STR, hash_script,
    };

    fn get_creation_pst(
        script_pubkey: &Address,
    ) -> Result<(
        (PartiallySignedTransaction, TaprootPubkeyGen),
        ScriptAuthArguments,
    )> {
        let asset_auth_arguments = ScriptAuthArguments {
            script_hash: hash_script(&script_pubkey.script_pubkey()),
        };

        Ok((
            build_script_auth_creation(
                (
                    OutPoint::default(),
                    TxOut {
                        asset: Asset::Explicit(*LIQUID_TESTNET_BITCOIN_ASSET),
                        value: Value::Explicit(500),
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
                &asset_auth_arguments,
                100,
                &AddressParams::LIQUID_TESTNET,
            )?,
            asset_auth_arguments,
        ))
    }

    #[test]
    fn test_script_auth_creation() -> Result<()> {
        let keypair = Keypair::from_secret_key(
            &Secp256k1::new(),
            &secp256k1::SecretKey::from_slice(&[1u8; 32])?,
        );
        let test_p2pkh_address = Address::p2pkh(
            &PublicKey::new(keypair.public_key()),
            None,
            &AddressParams::LIQUID_TESTNET,
        );

        let _ = get_creation_pst(&test_p2pkh_address)?;

        Ok(())
    }

    #[test]
    fn test_script_auth_unlock() -> Result<()> {
        let keypair = Keypair::from_secret_key(
            &Secp256k1::new(),
            &secp256k1::SecretKey::from_slice(&[1u8; 32])?,
        );
        let p2pkh_address = Address::p2pkh(
            &PublicKey::new(keypair.public_key()),
            None,
            &AddressParams::LIQUID_TESTNET,
        );

        let ((pst, script_auth_pubkey_gen), script_auth_arguments) =
            get_creation_pst(&p2pkh_address)?;

        let pst = pst.extract_tx()?;

        let locked_tx_out = pst.output[0].clone();

        let auth_asset_id = AssetId::from_str(LIQUID_TESTNET_TEST_ASSET_ID_STR)?;

        let (pst, witness_params) = build_script_auth_unlock(
            (OutPoint::default(), locked_tx_out),
            (
                OutPoint::default(),
                TxOut {
                    asset: Asset::Explicit(auth_asset_id),
                    value: Value::Explicit(1),
                    nonce: elements::confidential::Nonce::Null,
                    script_pubkey: p2pkh_address.script_pubkey(),
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
            &script_auth_arguments,
            50,
        )?;

        let program = get_compiled_script_auth_program(&script_auth_arguments);

        let env = ElementsEnv::new(
            Arc::new(pst.extract_tx()?),
            vec![
                ElementsUtxo {
                    script_pubkey: script_auth_pubkey_gen.address.script_pubkey(),
                    asset: Asset::Explicit(*LIQUID_TESTNET_BITCOIN_ASSET),
                    value: Value::Explicit(500),
                },
                ElementsUtxo {
                    script_pubkey: p2pkh_address.script_pubkey(),
                    asset: Asset::Explicit(auth_asset_id),
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

        let witness_values = build_script_auth_witness(&witness_params);

        assert!(
            run_program(&program, witness_values, &env, TrackerLogLevel::Trace).is_ok(),
            "expected success auth unlock with burn"
        );

        Ok(())
    }
}
