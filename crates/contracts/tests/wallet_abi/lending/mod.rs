use anyhow::Result;
use lending_contracts::{
    artifacts::lending::{LendingProgram, derived_lending::LendingArguments},
    programs::{Lending, LendingBranch},
};
use simplex::{
    program::{ArgumentsTrait, WitnessTrait},
    wallet_abi::{FinalizerSpec, SimfArguments, SimfWitness, WalletAbiHarness},
};

mod claim;
mod liquidate;
mod repay;

fn static_finalizer(
    harness: &WalletAbiHarness,
    source: &'static str,
    arguments: LendingArguments,
    witness: impl WitnessTrait,
) -> Result<FinalizerSpec> {
    Ok(harness.simf_finalizer(
        source,
        &SimfArguments::new(arguments.build_arguments()),
        &SimfWitness::new(witness.build_witness()),
    )?)
}

pub(crate) fn lending_repayment_finalizer(
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

pub(crate) fn lending_liquidation_finalizer(
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
