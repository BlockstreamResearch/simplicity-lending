use std::collections::HashMap;

use anyhow::{Result, anyhow};
use lending_contracts::{
    artifacts::{
        asset_auth::{AssetAuthProgram, derived_asset_auth::AssetAuthArguments},
        lending::{LendingProgram, derived_lending::LendingArguments},
        pre_lock::{PreLockProgram, derived_pre_lock::PreLockArguments},
        script_auth::{ScriptAuthProgram, derived_script_auth::ScriptAuthArguments},
    },
    programs::{
        AssetAuth, AssetAuthWitnessParams, Lending, LendingBranch, PreLock, PreLockBranch,
        PreLockParameters, ScriptAuth,
    },
    utils::LendingOfferParameters,
};
use simplex::{
    program::{ArgumentsTrait, WitnessTrait},
    simplicityhl::{
        WitnessValues,
        elements::{AssetId, OutPoint, Txid},
    },
    transaction::UTXO,
    utils::hash_script,
    wallet_abi::{
        AmountFilter as WalletAmountFilter, AssetFilter, FinalizerSpec, LockFilter,
        RuntimeSimfWitness, SimfArguments, SimfWitness, UTXOSource, WalletAbiHarness,
        WalletSourceFilter,
    },
};

use crate::common::{
    issuance::{issue_asset, issue_preparation_utxos_tx, issue_utility_nfts_tx},
    tx_steps::{finalize_and_broadcast, wait_for_tx},
    wallet::{
        AmountFilter as DirectAmountFilter, filter_signer_utxos_by_asset_and_amount,
        get_split_utxo_ft, split_first_signer_utxo,
    },
};

pub const FEE_INPUT_MIN_AMOUNT: u64 = 100_000;
pub const PARAMETER_NFT_DECIMALS: u8 = 1;
const PRE_LOCK_SETUP_POLICY_SPLITS: [u64; 3] = [1_000, 2_000, 5_000];
const ISSUED_PRINCIPAL_AMOUNT: u64 = 20_000;

pub struct PreLockWalletSetup {
    pub pre_lock_parameters: PreLockParameters,
}

pub fn policy_fee_source(harness: &WalletAbiHarness) -> UTXOSource {
    UTXOSource::Wallet {
        filter: WalletSourceFilter {
            asset: AssetFilter::Exact {
                asset_id: harness.network().policy_asset(),
            },
            amount: WalletAmountFilter::Min {
                amount_sat: FEE_INPUT_MIN_AMOUNT,
            },
            lock: LockFilter::None,
        },
    }
}

pub fn setup_pre_lock_wallet_state(context: &simplex::TestContext) -> Result<PreLockWalletSetup> {
    let provider = context.get_default_provider();
    let signer = context.get_default_signer();
    let network = context.get_network();

    let txid = split_first_signer_utxo(context, PRE_LOCK_SETUP_POLICY_SPLITS.to_vec());
    wait_for_tx(context, &txid)?;

    let (txid, preparation_asset_id) = issue_preparation_utxos_tx(context)?;
    wait_for_tx(context, &txid)?;

    let (txid, principal_asset_id) = issue_asset(context, ISSUED_PRINCIPAL_AMOUNT)?;
    wait_for_tx(context, &txid)?;

    let current_height = provider.fetch_tip_height()?;
    let offer_parameters = LendingOfferParameters {
        collateral_amount: PRE_LOCK_SETUP_POLICY_SPLITS[0],
        principal_amount: PRE_LOCK_SETUP_POLICY_SPLITS[2],
        loan_expiration_time: current_height + 10,
        principal_interest_rate: 200,
    };

    let utility_nfts_txid =
        issue_utility_nfts_tx(context, &offer_parameters, preparation_asset_id)?;
    wait_for_tx(context, &utility_nfts_txid)?;

    let signer_script = signer.get_address().script_pubkey();

    let txid = signer.send(signer_script.clone(), FEE_INPUT_MIN_AMOUNT)?;
    wait_for_tx(context, &txid)?;

    let txid = signer.send(signer_script, offer_parameters.collateral_amount)?;
    wait_for_tx(context, &txid)?;

    let utility_nfts_tx = provider.fetch_transaction(&utility_nfts_txid)?;
    let pre_lock_parameters = PreLockParameters {
        collateral_asset_id: network.policy_asset(),
        principal_asset_id,
        first_parameters_nft_asset_id: utility_nfts_tx.output[0].asset.explicit().unwrap(),
        second_parameters_nft_asset_id: utility_nfts_tx.output[1].asset.explicit().unwrap(),
        borrower_nft_asset_id: utility_nfts_tx.output[2].asset.explicit().unwrap(),
        lender_nft_asset_id: utility_nfts_tx.output[3].asset.explicit().unwrap(),
        offer_parameters,
        borrower_pubkey: signer.get_schnorr_public_key(),
        borrower_output_script_hash: hash_script(&signer.get_address().script_pubkey()),
        network: *network,
    };

    Ok(PreLockWalletSetup {
        pre_lock_parameters,
    })
}

pub fn fetch_output_utxo(context: &simplex::TestContext, txid: Txid, vout: u32) -> Result<UTXO> {
    let tx = context.get_default_provider().fetch_transaction(&txid)?;
    let txout = tx
        .output
        .get(vout as usize)
        .cloned()
        .ok_or_else(|| anyhow!("missing tx output {txid}:{vout}"))?;

    Ok(UTXO {
        outpoint: OutPoint::new(txid, vout),
        txout,
        secrets: None,
    })
}

pub fn ensure_exact_asset_utxo(
    context: &simplex::TestContext,
    asset_id: AssetId,
    amount: u64,
) -> Result<()> {
    let signer = context.get_default_signer();

    let exact = filter_signer_utxos_by_asset_and_amount(
        signer,
        asset_id,
        amount,
        DirectAmountFilter::EqualTo,
    );
    if !exact.is_empty() {
        return Ok(());
    }

    let candidate = filter_signer_utxos_by_asset_and_amount(
        signer,
        asset_id,
        amount,
        DirectAmountFilter::GreaterThan,
    )
    .into_iter()
    .next()
    .ok_or_else(|| anyhow!("no {asset_id} utxo found with amount greater than {amount}"))?;

    let ft = get_split_utxo_ft(candidate, vec![amount], signer, *context.get_network());
    let txid = finalize_and_broadcast(context, &ft)?;
    wait_for_tx(context, &txid)?;

    Ok(())
}

fn static_finalizer<A, W>(
    harness: &WalletAbiHarness,
    source: &'static str,
    arguments: A,
    witness: W,
) -> Result<FinalizerSpec>
where
    A: ArgumentsTrait,
    W: WitnessTrait,
{
    Ok(harness.simf_finalizer(
        source,
        &SimfArguments::new(arguments.build_arguments()),
        &SimfWitness::new(witness.build_witness()),
    )?)
}

pub fn script_auth_finalizer(
    harness: &WalletAbiHarness,
    script_auth: &ScriptAuth,
    input_script_index: u32,
) -> Result<FinalizerSpec> {
    static_finalizer(
        harness,
        ScriptAuthProgram::SOURCE,
        ScriptAuthArguments::from(*script_auth.get_script_auth_parameters()),
        ScriptAuth::get_script_auth_witness(input_script_index),
    )
}

pub fn asset_auth_finalizer(
    harness: &WalletAbiHarness,
    asset_auth: &AssetAuth,
) -> Result<FinalizerSpec> {
    static_finalizer(
        harness,
        AssetAuthProgram::SOURCE,
        AssetAuthArguments::from(*asset_auth.get_asset_auth_parameters()),
        AssetAuth::get_asset_auth_witness(&AssetAuthWitnessParams {
            input_asset_index: 1,
            output_asset_index: 1,
        }),
    )
}

pub fn pre_lock_lending_creation_finalizer(
    harness: &WalletAbiHarness,
    pre_lock: &PreLock,
) -> Result<FinalizerSpec> {
    static_finalizer(
        harness,
        PreLockProgram::SOURCE,
        PreLockArguments::from(*pre_lock.get_pre_lock_parameters()),
        PreLock::get_pre_lock_witness(&PreLockBranch::LendingCreation),
    )
}

pub fn pre_lock_cancellation_finalizer(
    harness: &WalletAbiHarness,
    pre_lock: &PreLock,
) -> Result<FinalizerSpec> {
    let branch_witness =
        PreLock::get_pre_lock_witness(&PreLockBranch::PreLockCancellation).build_witness();
    let resolved = WitnessValues::from(
        branch_witness
            .iter()
            .filter(|(name, _)| name.to_string() != "SIGNATURE")
            .map(|(name, value)| (name.clone(), value.clone()))
            .collect::<HashMap<_, _>>(),
    );

    Ok(harness.simf_finalizer(
        PreLockProgram::SOURCE,
        &SimfArguments::new(
            PreLockArguments::from(*pre_lock.get_pre_lock_parameters()).build_arguments(),
        ),
        &SimfWitness {
            resolved,
            runtime_arguments: vec![RuntimeSimfWitness::SigHashAll {
                name: "SIGNATURE".to_string(),
                public_key: pre_lock.get_pre_lock_parameters().borrower_pubkey,
            }],
        },
    )?)
}

pub fn lending_repayment_finalizer(
    harness: &WalletAbiHarness,
    lending: &Lending,
) -> Result<FinalizerSpec> {
    static_finalizer(
        harness,
        LendingProgram::SOURCE,
        LendingArguments::from(*lending.get_lending_parameters()),
        Lending::get_lending_witness(&LendingBranch::LoanRepayment),
    )
}

pub fn lending_liquidation_finalizer(
    harness: &WalletAbiHarness,
    lending: &Lending,
) -> Result<FinalizerSpec> {
    static_finalizer(
        harness,
        LendingProgram::SOURCE,
        LendingArguments::from(*lending.get_lending_parameters()),
        Lending::get_lending_witness(&LendingBranch::LoanLiquidation),
    )
}

pub fn lender_principal_asset_auth(lending: &Lending) -> AssetAuth {
    lending
        .get_lending_parameters()
        .get_lender_principal_asset_auth()
}

pub fn script_auth_from_lending(lending: &Lending) -> ScriptAuth {
    ScriptAuth::from_simplex_program(lending)
}

pub fn principal_with_interest(lending: &Lending) -> u64 {
    lending
        .get_lending_parameters()
        .offer_parameters
        .calculate_principal_with_interest()
}
