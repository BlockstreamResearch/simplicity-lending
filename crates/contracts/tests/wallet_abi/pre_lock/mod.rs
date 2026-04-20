use std::collections::HashMap;

use anyhow::Result;
use lending_contracts::{
    artifacts::pre_lock::{PreLockProgram, derived_pre_lock::PreLockArguments},
    programs::{PreLock, PreLockBranch},
};
use simplex::{
    program::{ArgumentsTrait, WitnessTrait},
    simplicityhl::WitnessValues,
    wallet_abi::{FinalizerSpec, RuntimeSimfWitness, SimfArguments, SimfWitness, WalletAbiHarness},
};

mod accept;
mod cancel;
mod create;

fn static_finalizer(
    harness: &WalletAbiHarness,
    source: &'static str,
    arguments: PreLockArguments,
    witness: impl WitnessTrait,
) -> Result<FinalizerSpec> {
    Ok(harness.simf_finalizer(
        source,
        &SimfArguments::new(arguments.build_arguments()),
        &SimfWitness::new(witness.build_witness()),
    )?)
}

pub(crate) fn pre_lock_lending_creation_finalizer(
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

pub(crate) fn pre_lock_cancellation_finalizer(
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
