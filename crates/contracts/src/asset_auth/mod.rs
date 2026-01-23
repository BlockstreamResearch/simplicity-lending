use std::sync::Arc;

use simplicityhl_core::{
    ProgramError, SimplicityNetwork, control_block, create_p2tr_address, get_and_verify_env,
    load_program, run_program,
};

use simplicityhl::elements::{Address, Transaction, TxInWitness, TxOut};

use simplicityhl::simplicity::RedeemNode;
use simplicityhl::simplicity::jet::Elements;
use simplicityhl::simplicity::{bitcoin::XOnlyPublicKey, jet::elements::ElementsEnv};

use simplicityhl::tracker::TrackerLogLevel;
use simplicityhl::{CompiledProgram, TemplateProgram};

pub mod build_arguments;
pub mod build_witness;

use build_arguments::AssetAuthArguments;

use crate::asset_auth::build_witness::{AssetAuthWitnessParams, build_asset_auth_witness};

pub const ASSET_AUTH_SOURCE: &str = include_str!("source_simf/asset_auth.simf");

/// Get the asset auth template program for instantiation.
///
/// # Panics
/// - if the embedded source fails to compile (should never happen).
#[must_use]
pub fn get_asset_auth_template_program() -> TemplateProgram {
    TemplateProgram::new(ASSET_AUTH_SOURCE)
        .expect("INTERNAL: expected Asset Auth Program to compile successfully.")
}

/// Derive P2TR address for an asset auth contract.
///
/// # Errors
/// Returns error if program compilation fails.
pub fn get_asset_auth_address(
    x_only_public_key: &XOnlyPublicKey,
    arguments: &AssetAuthArguments,
    network: SimplicityNetwork,
) -> Result<Address, ProgramError> {
    Ok(create_p2tr_address(
        get_asset_auth_program(arguments)?.commit().cmr(),
        x_only_public_key,
        network.address_params(),
    ))
}

/// Compile asset auth program with the given arguments.
///
/// # Errors
/// Returns error if compilation fails.
pub fn get_asset_auth_program(
    arguments: &AssetAuthArguments,
) -> Result<CompiledProgram, ProgramError> {
    load_program(ASSET_AUTH_SOURCE, arguments.build_asset_auth_arguments())
}

/// Get compiled asset auth program, panicking on failure.
///
/// # Panics
/// - if program instantiation fails.
#[must_use]
pub fn get_compiled_asset_auth_program(arguments: &AssetAuthArguments) -> CompiledProgram {
    let program = get_asset_auth_template_program();

    program
        .instantiate(arguments.build_asset_auth_arguments(), true)
        .unwrap()
}

/// Execute asset auth program with the specific witness parameters.
///
/// # Errors
/// Returns error if program execution fails.
pub fn execute_asset_auth_program(
    compiled_program: &CompiledProgram,
    env: &ElementsEnv<Arc<Transaction>>,
    witness_params: &AssetAuthWitnessParams,
    runner_log_level: TrackerLogLevel,
) -> Result<Arc<RedeemNode<Elements>>, ProgramError> {
    let witness_values = build_asset_auth_witness(witness_params);

    Ok(run_program(compiled_program, witness_values, env, runner_log_level)?.0)
}

/// Finalize asset auth transaction with Simplicity witness.
///
/// # Errors
/// Returns error if program execution fails or script pubkey doesn't match.
#[allow(clippy::too_many_arguments)]
pub fn finalize_asset_auth_transaction(
    mut tx: Transaction,
    asset_auth_public_key: &XOnlyPublicKey,
    asset_auth_program: &CompiledProgram,
    utxos: &[TxOut],
    input_index: usize,
    witness_params: &AssetAuthWitnessParams,
    network: SimplicityNetwork,
    log_level: TrackerLogLevel,
) -> Result<Transaction, ProgramError> {
    let env = get_and_verify_env(
        &tx,
        asset_auth_program,
        asset_auth_public_key,
        utxos,
        network,
        input_index,
    )?;

    let pruned = execute_asset_auth_program(asset_auth_program, &env, witness_params, log_level)?;

    let (simplicity_program_bytes, simplicity_witness_bytes) = pruned.to_vec_with_witness();
    let cmr = pruned.cmr();

    tx.input[input_index].witness = TxInWitness {
        amount_rangeproof: None,
        inflation_keys_rangeproof: None,
        script_witness: vec![
            simplicity_witness_bytes,
            simplicity_program_bytes,
            cmr.as_ref().to_vec(),
            control_block(cmr, *asset_auth_public_key).serialize(),
        ],
        pegin_witness: vec![],
    };

    Ok(tx)
}

#[cfg(test)]
mod asset_auth_tests {
    use crate::sdk::{build_asset_auth_creation, build_asset_auth_unlock};

    use super::*;

    use anyhow::Result;
    use simplicityhl::elements::confidential::{Asset, Value};
    use simplicityhl::simplicity::elements::{self, AssetId, OutPoint};
    use simplicityhl::simplicity::hashes::Hash;
    use std::str::FromStr;

    use simplicity_contracts::sdk::taproot_pubkey_gen::TaprootPubkeyGen;

    use simplicityhl::elements::Script;
    use simplicityhl::elements::pset::PartiallySignedTransaction;
    use simplicityhl::elements::taproot::ControlBlock;
    use simplicityhl::simplicity::jet::elements::ElementsUtxo;
    use simplicityhl_core::{LIQUID_TESTNET_BITCOIN_ASSET, LIQUID_TESTNET_TEST_ASSET_ID_STR};

    const NETWORK: SimplicityNetwork = SimplicityNetwork::LiquidTestnet;

    fn get_creation_pst(
        asset_id: AssetId,
        asset_amount: u64,
        with_asset_burn: bool,
    ) -> Result<(
        (PartiallySignedTransaction, TaprootPubkeyGen),
        AssetAuthArguments,
    )> {
        let asset_auth_arguments = AssetAuthArguments {
            asset_id: asset_id.into_inner().0,
            asset_amount,
            with_asset_burn,
        };

        Ok((
            build_asset_auth_creation(
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
                NETWORK,
            )?,
            asset_auth_arguments,
        ))
    }

    #[test]
    fn test_asset_auth_creation() -> Result<()> {
        let _ = get_creation_pst(*LIQUID_TESTNET_BITCOIN_ASSET, 500, false)?;

        Ok(())
    }

    #[test]
    fn test_asset_auth_unlock_with_burn() -> Result<()> {
        let auth_asset_amount = 100;
        let auth_asset_id = AssetId::from_str(LIQUID_TESTNET_TEST_ASSET_ID_STR)?;

        let ((pst, asset_auth_pubkey_gen), asset_auth_arguments) =
            get_creation_pst(auth_asset_id, auth_asset_amount, true)?;

        let pst = pst.extract_tx()?;

        let locked_tx_out = pst.output[0].clone();

        let (pst, witness_params) = build_asset_auth_unlock(
            (OutPoint::default(), locked_tx_out),
            (
                OutPoint::default(),
                TxOut {
                    asset: Asset::Explicit(auth_asset_id),
                    value: Value::Explicit(auth_asset_amount),
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
            50,
        )?;

        let program = get_compiled_asset_auth_program(&asset_auth_arguments);

        let env = ElementsEnv::new(
            Arc::new(pst.extract_tx()?),
            vec![
                ElementsUtxo {
                    script_pubkey: asset_auth_pubkey_gen.address.script_pubkey(),
                    asset: Asset::Explicit(*LIQUID_TESTNET_BITCOIN_ASSET),
                    value: Value::Explicit(500),
                },
                ElementsUtxo {
                    script_pubkey: Script::new(),
                    asset: Asset::Explicit(auth_asset_id),
                    value: Value::Explicit(auth_asset_amount),
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

        let witness_values = build_asset_auth_witness(&witness_params);

        assert!(
            run_program(&program, witness_values, &env, TrackerLogLevel::Trace).is_ok(),
            "expected success auth unlock with burn"
        );

        let pst = pst.extract_tx()?;

        assert_eq!(pst.output.len(), 3, "Invalid outputs count");

        let asset_output = pst.output[1].clone();

        assert!(asset_output.is_null_data(), "Must have OP_RETURN");

        Ok(())
    }

    #[test]
    fn test_asset_auth_unlock_without_burn() -> Result<()> {
        let auth_asset_amount = 100;
        let auth_asset_id = AssetId::from_str(LIQUID_TESTNET_TEST_ASSET_ID_STR)?;

        let ((pst, asset_auth_pubkey_gen), asset_auth_arguments) =
            get_creation_pst(auth_asset_id, auth_asset_amount, false)?;

        let pst = pst.extract_tx()?;

        let locked_tx_out = pst.output[0].clone();

        let (pst, witness_params) = build_asset_auth_unlock(
            (OutPoint::default(), locked_tx_out),
            (
                OutPoint::default(),
                TxOut {
                    asset: Asset::Explicit(auth_asset_id),
                    value: Value::Explicit(auth_asset_amount),
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
            50,
        )?;

        let program = get_compiled_asset_auth_program(&asset_auth_arguments);

        let env = ElementsEnv::new(
            Arc::new(pst.extract_tx()?),
            vec![
                ElementsUtxo {
                    script_pubkey: asset_auth_pubkey_gen.address.script_pubkey(),
                    asset: Asset::Explicit(*LIQUID_TESTNET_BITCOIN_ASSET),
                    value: Value::Explicit(500),
                },
                ElementsUtxo {
                    script_pubkey: Script::new(),
                    asset: Asset::Explicit(auth_asset_id),
                    value: Value::Explicit(auth_asset_amount),
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

        let witness_values = build_asset_auth_witness(&witness_params);

        assert!(
            run_program(&program, witness_values, &env, TrackerLogLevel::Trace).is_ok(),
            "expected success auth unlock with burn"
        );

        let pst = pst.extract_tx()?;

        assert_eq!(pst.output.len(), 3, "Invalid outputs count");

        let asset_output = pst.output[1].clone();

        assert!(!asset_output.is_null_data(), "Must not have OP_RETURN");

        Ok(())
    }
}
