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

use build_arguments::LendingArguments;

use crate::lending::build_witness::{LendingBranch, build_lending_witness};

pub const LENDING_SOURCE: &str = include_str!("source_simf/lending.simf");

pub fn get_lending_template_program() -> TemplateProgram {
    TemplateProgram::new(LENDING_SOURCE)
        .expect("INTERNAL: expected Lending Program to compile successfully.")
}

pub fn get_lending_address(
    x_only_public_key: &XOnlyPublicKey,
    arguments: &LendingArguments,
    params: &'static AddressParams,
) -> Result<Address, ProgramError> {
    Ok(create_p2tr_address(
        get_lending_program(arguments)?.commit().cmr(),
        x_only_public_key,
        params,
    ))
}

pub fn get_lending_program(arguments: &LendingArguments) -> Result<CompiledProgram, ProgramError> {
    load_program(LENDING_SOURCE, arguments.build_lending_arguments())
}

pub fn get_compiled_lending_program(arguments: &LendingArguments) -> CompiledProgram {
    let program = get_lending_template_program();

    program
        .instantiate(arguments.build_lending_arguments(), true)
        .unwrap()
}

pub fn execute_lending_program(
    compiled_program: &CompiledProgram,
    env: &ElementsEnv<Arc<Transaction>>,
    lending_branch: LendingBranch,
    runner_log_level: TrackerLogLevel,
) -> Result<Arc<RedeemNode<Elements>>, ProgramError> {
    let witness_values = build_lending_witness(lending_branch);

    Ok(run_program(compiled_program, witness_values, env, runner_log_level)?.0)
}

#[allow(clippy::too_many_arguments)]
pub fn finalize_lending_transaction(
    mut tx: Transaction,
    options_public_key: &XOnlyPublicKey,
    options_program: &CompiledProgram,
    utxos: &[TxOut],
    input_index: usize,
    lending_branch: LendingBranch,
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
        execute_lending_program(options_program, &env, lending_branch, TrackerLogLevel::None)?;

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
    use crate::lending::build_witness::LendingBranch;
    use crate::sdk::parameters::{
        FirstNFTParameters, SecondNFTParameters, calculate_principal_with_interest, to_base_amount,
    };
    use crate::sdk::{build_lending_creation, build_lending_loan_repayment, taproot_unspendable_internal_key};

    use super::*;

    use anyhow::{Ok, Result};
    use simplicityhl::elements::confidential::{Asset, Value};
    use simplicityhl::elements::hex::ToHex;
    use simplicityhl::elements::taproot::ControlBlock;
    use simplicityhl::simplicity::elements::{self, AssetId, OutPoint};
    use simplicityhl::simplicity::hashes::Hash;
    use simplicityhl::simplicity::jet::elements::ElementsUtxo;
    use std::str::FromStr;

    use simplicity_contracts::sdk::taproot_pubkey_gen::TaprootPubkeyGen;

    use simplicityhl::elements::pset::PartiallySignedTransaction;
    use simplicityhl::elements::{Script, Txid};
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
        collateral_amount: u64,
        principal_amount: u64,
        loan_expiration_time: u32,
        principal_interest_rate: u16,
    ) -> Result<(
        (PartiallySignedTransaction, TaprootPubkeyGen),
        LendingArguments,
    )> {
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

        println!(
            "CREATION lender_principal_script - {}",
            lender_principal_script
        );
        let principal_auth_script_hash = hash_script(&lender_principal_script);

        let lending_arguments = LendingArguments::new(
            collateral_asset_id.into_inner().0,
            principal_asset_id.into_inner().0,
            borrower_nft_asset_id.into_inner().0,
            lender_nft_asset_id.into_inner().0,
            first_parameters_nft_asset_id.into_inner().0,
            second_parameters_nft_asset_id.into_inner().0,
            principal_auth_script_hash,
            collateral_amount,
            principal_amount,
            loan_expiration_time,
            principal_interest_rate,
        );

        Ok((
            build_lending_creation(
                (
                    OutPoint::default(),
                    TxOut {
                        asset: Asset::Explicit(collateral_asset_id),
                        value: Value::Explicit(collateral_amount),
                        nonce: elements::confidential::Nonce::Null,
                        script_pubkey: Script::new(),
                        witness: elements::TxOutWitness::default(),
                    },
                ),
                (
                    OutPoint::default(),
                    TxOut {
                        asset: Asset::Explicit(principal_asset_id),
                        value: Value::Explicit(principal_amount),
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
                &lending_arguments,
                &Script::new(),
                &Script::new(),
                &Script::new(),
                100,
                &AddressParams::LIQUID_TESTNET,
            )?,
            lending_arguments,
        ))
    }

    #[test]
    fn test_lending_creation() -> Result<()> {
        let outpoint = OutPoint::new(Txid::from_slice(&[2; 32])?, 33);

        let first_asset_entropy = get_new_asset_entropy(&outpoint, [1; 32]);
        let second_asset_entropy = get_new_asset_entropy(&outpoint, [2; 32]);
        let third_asset_entropy = get_new_asset_entropy(&outpoint, [3; 32]);
        let fourth_asset_entropy = get_new_asset_entropy(&outpoint, [3; 32]);

        let first_parameters_nft_asset_id = AssetId::from_entropy(first_asset_entropy);
        let second_parameters_nft_asset_id = AssetId::from_entropy(second_asset_entropy);
        let borrower_nft_asset_id = AssetId::from_entropy(third_asset_entropy);
        let lender_nft_asset_id = AssetId::from_entropy(fourth_asset_entropy);

        let collateral_amount = 10000;
        let principal_amount = 4000;
        let loan_expiration_time = 100;
        let principal_interest_rate = 250; // 2.5%

        let first_parameters_nft_encoded_amount =
            FirstNFTParameters::encode(principal_interest_rate, loan_expiration_time, 2, 2)
                .expect("Failed to encode first parameters nft amount");
        let second_parameters_nft_encoded_amount = SecondNFTParameters::encode(
            to_base_amount(collateral_amount, 2),
            to_base_amount(principal_amount, 2),
        )
        .expect("Failed to encode second parameters nft amount");

        let _ = get_creation_pst(
            *LIQUID_TESTNET_BITCOIN_ASSET,
            AssetId::from_str(LIQUID_TESTNET_TEST_ASSET_ID_STR)?,
            first_parameters_nft_asset_id,
            second_parameters_nft_asset_id,
            borrower_nft_asset_id,
            lender_nft_asset_id,
            first_parameters_nft_encoded_amount,
            second_parameters_nft_encoded_amount,
            collateral_amount,
            principal_amount,
            loan_expiration_time,
            principal_interest_rate,
        )?;

        Ok(())
    }

    #[test]
    fn test_loan_repayment() -> Result<()> {
        let outpoint = OutPoint::new(Txid::from_slice(&[2; 32])?, 33);

        let first_asset_entropy = get_new_asset_entropy(&outpoint, [1; 32]);
        let second_asset_entropy = get_new_asset_entropy(&outpoint, [2; 32]);
        let third_asset_entropy = get_new_asset_entropy(&outpoint, [3; 32]);
        let fourth_asset_entropy = get_new_asset_entropy(&outpoint, [4; 32]);

        let principal_asset_id = AssetId::from_str(LIQUID_TESTNET_TEST_ASSET_ID_STR)?;
        let first_parameters_nft_asset_id = AssetId::from_entropy(first_asset_entropy);
        let second_parameters_nft_asset_id = AssetId::from_entropy(second_asset_entropy);
        let borrower_nft_asset_id = AssetId::from_entropy(third_asset_entropy);
        let lender_nft_asset_id = AssetId::from_entropy(fourth_asset_entropy);

        println!("principal_asset_id - {}", principal_asset_id.to_string());
        println!(
            "collateral_asset_id - {}",
            (*LIQUID_TESTNET_BITCOIN_ASSET).to_hex()
        );
        println!(
            "first_parameters_nft_asset_id - {}",
            first_parameters_nft_asset_id.to_hex()
        );
        println!(
            "second_parameters_nft_asset_id - {}",
            second_parameters_nft_asset_id.to_hex()
        );
        println!("borrower_nft_asset_id - {}", borrower_nft_asset_id.to_hex());
        println!("lender_nft_asset_id - {}", lender_nft_asset_id.to_hex());

        let amounts_dec = 2;
        let collateral_amount = 10000;
        let principal_amount = 4000;
        let loan_expiration_time = 100;
        let principal_interest_rate = 250; // 2.5%

        let first_parameters_nft_encoded_amount = FirstNFTParameters::encode(
            principal_interest_rate,
            loan_expiration_time,
            amounts_dec,
            amounts_dec,
        )
        .expect("Failed to encode first parameters nft amount");
        let second_parameters_nft_encoded_amount = SecondNFTParameters::encode(
            to_base_amount(collateral_amount, amounts_dec),
            to_base_amount(principal_amount, amounts_dec),
        )
        .expect("Failed to encode second parameters nft amount");

        let ((pst, lending_pubkey_gen), lending_arguments) = get_creation_pst(
            *LIQUID_TESTNET_BITCOIN_ASSET,
            AssetId::from_str(LIQUID_TESTNET_TEST_ASSET_ID_STR)?,
            first_parameters_nft_asset_id,
            second_parameters_nft_asset_id,
            borrower_nft_asset_id,
            lender_nft_asset_id,
            first_parameters_nft_encoded_amount,
            second_parameters_nft_encoded_amount,
            collateral_amount,
            principal_amount,
            loan_expiration_time,
            principal_interest_rate,
        )?;

        let pst = pst.extract_tx()?;

        let lending_tx_out = pst.output[0].clone();

        let principal_amount_with_interest =
            calculate_principal_with_interest(principal_amount, principal_interest_rate);

        let pst = build_lending_loan_repayment(
            (OutPoint::default(), lending_tx_out),
            (
                OutPoint::default(),
                TxOut {
                    asset: Asset::Explicit(principal_asset_id),
                    value: Value::Explicit(principal_amount_with_interest),
                    nonce: elements::confidential::Nonce::Null,
                    script_pubkey: Script::new(),
                    witness: elements::TxOutWitness::default(),
                },
            ),
            (
                OutPoint::default(),
                TxOut {
                    asset: Asset::Explicit(first_parameters_nft_asset_id),
                    value: Value::Explicit(first_parameters_nft_encoded_amount),
                    nonce: elements::confidential::Nonce::Null,
                    script_pubkey: Script::new(),
                    witness: elements::TxOutWitness::default(),
                },
            ),
            (
                OutPoint::default(),
                TxOut {
                    asset: Asset::Explicit(second_parameters_nft_asset_id),
                    value: Value::Explicit(second_parameters_nft_encoded_amount),
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
                    asset: Asset::Explicit(*LIQUID_TESTNET_BITCOIN_ASSET),
                    value: Value::Explicit(100),
                    nonce: elements::confidential::Nonce::Null,
                    script_pubkey: Script::new(),
                    witness: elements::TxOutWitness::default(),
                },
            ),
            &lending_arguments,
            &Script::new(),
            100,
            &AddressParams::LIQUID_TESTNET,
        )?;

        let program = get_compiled_lending_program(&lending_arguments);

        let env = ElementsEnv::new(
            Arc::new(pst.extract_tx()?),
            vec![
                ElementsUtxo {
                    script_pubkey: lending_pubkey_gen.address.script_pubkey(),
                    asset: Asset::Explicit(*LIQUID_TESTNET_BITCOIN_ASSET),
                    value: Value::Explicit(collateral_amount),
                },
                ElementsUtxo {
                    script_pubkey: Script::new(),
                    asset: Asset::Explicit(first_parameters_nft_asset_id),
                    value: Value::Explicit(first_parameters_nft_encoded_amount),
                },
                ElementsUtxo {
                    script_pubkey: Script::new(),
                    asset: Asset::Explicit(second_parameters_nft_asset_id),
                    value: Value::Explicit(second_parameters_nft_encoded_amount),
                },
                ElementsUtxo {
                    script_pubkey: Script::new(),
                    asset: Asset::Explicit(borrower_nft_asset_id),
                    value: Value::Explicit(1),
                },
                ElementsUtxo {
                    script_pubkey: Script::new(),
                    asset: Asset::Explicit(principal_asset_id),
                    value: Value::Explicit(principal_amount_with_interest),
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

        let witness_values = build_lending_witness(LendingBranch::LoanRepayment);

        assert!(
            run_program(&program, witness_values, &env, TrackerLogLevel::Trace).is_ok(),
            "expected success loan repayment"
        );

        Ok(())
    }
}
