use simplex::fuzz::proptest::prelude::{Strategy, any};
use simplex::{FuzzMode, TestContext};

use lending_contracts_v2::artifacts::tests::vault::accounting::AccountingProgram;
use lending_contracts_v2::artifacts::tests::vault::accounting::derived_accounting::{
    AccountingArguments, AccountingWitness,
};
use lending_contracts_v2::lender_principal_vault::LenderPrincipalVaultStorage;
use lending_contracts_v2::utils::protocol_fee::FEE_RATE_DENOMINATOR;

use super::cases::{fresh, from_tuple, storages, tuple};
use crate::support::{expect, fuzz};

/// The functions of the test program, by the index it selects them with.
#[derive(Clone, Copy)]
enum Function {
    AvailableLenderShares,
    AvailableProtocolFee,
}

const FUNCTIONS: u8 = 2;

const TEN_PERCENT: u64 = FEE_RATE_DENOMINATOR / 10;

fn program() -> AccountingProgram {
    AccountingProgram::new(AccountingArguments::default())
}

fn case(
    function: Function,
    storage: &LenderPrincipalVaultStorage,
    protocol_fee_rate: u64,
    expected: u64,
) -> AccountingWitness {
    AccountingWitness {
        function_index: function as u8,
        storage: tuple(storage),
        protocol_fee_rate,
        expected,
    }
}

/// What the SDK computes for the function `witness` selects, `None` where it fails.
fn model(witness: &AccountingWitness) -> Option<u64> {
    let storage = from_tuple(witness.storage);

    let result = if witness.function_index == Function::AvailableLenderShares as u8 {
        storage.available_lender_shares(witness.protocol_fee_rate)
    } else {
        storage.available_protocol_fee(witness.protocol_fee_rate)
    };

    result.ok()
}

fn vault(
    supplied_amount: u64,
    supplied_fee: u64,
    withdrawn_amount: u64,
    withdrawn_protocol_fee: u64,
) -> LenderPrincipalVaultStorage {
    LenderPrincipalVaultStorage {
        supplied_amount,
        supplied_fee,
        withdrawn_amount,
        withdrawn_protocol_fee,
        ..fresh()
    }
}

/// The program accepts the SDK's result for each case and rejects anything else.
#[track_caller]
fn assert_matches_sdk(function: Function, cases: &[(LenderPrincipalVaultStorage, u64)]) {
    let program = program();

    for (storage, protocol_fee_rate) in cases {
        let mut witness = case(function, storage, *protocol_fee_rate, 0);
        witness.expected = model(&witness).expect("the case is consistent");

        expect::accepts(program.as_ref(), witness.clone());

        witness.expected = witness.expected.wrapping_add(1);
        expect::rejects(program.as_ref(), witness);
    }
}

/// The SDK fails on each case and the program rejects it.
#[track_caller]
fn assert_rejects(function: Function, cases: &[(LenderPrincipalVaultStorage, u64)]) {
    let program = program();

    for (storage, protocol_fee_rate) in cases {
        let witness = case(function, storage, *protocol_fee_rate, 0);

        assert_eq!(model(&witness), None);
        expect::rejects(program.as_ref(), witness);
    }
}

#[test]
fn rejects_unknown_function() {
    let mut witness = case(Function::AvailableLenderShares, &fresh(), 0, 0);
    witness.function_index = FUNCTIONS;

    expect::rejects(program().as_ref(), witness);
}

#[test]
fn available_lender_shares_matches_sdk() {
    assert_matches_sdk(
        Function::AvailableLenderShares,
        &[
            // Nothing supplied
            (vault(0, 0, 0, 0), TEN_PERCENT),
            (vault(1_000, 100, 0, 0), TEN_PERCENT),
            (vault(1_000, 100, 300, 10), TEN_PERCENT),
            // The protocol's part is taken from all the fee supplied, rounded down once
            (vault(1_000, 15, 0, 0), TEN_PERCENT),
            // All the fee goes to the protocol, or none of it
            (vault(1_000, 1_000, 0, 0), FEE_RATE_DENOMINATOR),
            (vault(1_000, 100, 0, 0), 0),
            // The lender withdrew the whole share
            (vault(1_000, 100, 990, 0), TEN_PERCENT),
            (vault(u64::MAX, u64::MAX, 0, 0), FEE_RATE_DENOMINATOR / 2),
        ],
    );
}

#[test]
fn available_lender_shares_rejects_inconsistent_state() {
    assert_rejects(
        Function::AvailableLenderShares,
        &[
            // The lender withdrew more than the share
            (vault(1_000, 100, 991, 0), TEN_PERCENT),
            // The protocol's part is more than the supplied amount
            (vault(500, 1_000, 0, 0), FEE_RATE_DENOMINATOR),
            // The protocol's part overflows u64 at a rate above 100%
            (vault(u64::MAX, u64::MAX, 0, 0), FEE_RATE_DENOMINATOR + 1),
        ],
    );
}

#[test]
fn available_protocol_fee_matches_sdk() {
    assert_matches_sdk(
        Function::AvailableProtocolFee,
        &[
            (vault(0, 0, 0, 0), TEN_PERCENT),
            (vault(1_000, 100, 0, 0), TEN_PERCENT),
            // The harvester withdrew the whole fee
            (vault(1_000, 100, 0, 10), TEN_PERCENT),
            // The protocol's part is taken from all the fee supplied, rounded down once
            (vault(1_000, 15, 0, 0), TEN_PERCENT),
            (vault(1_000, 100, 0, 0), FEE_RATE_DENOMINATOR),
            (vault(1_000, 100, 0, 0), 0),
            (vault(u64::MAX, u64::MAX, 0, 0), FEE_RATE_DENOMINATOR),
        ],
    );
}

#[test]
fn available_protocol_fee_rejects_inconsistent_state() {
    assert_rejects(
        Function::AvailableProtocolFee,
        &[
            // The harvester withdrew more than the protocol's part
            (vault(1_000, 100, 0, 11), TEN_PERCENT),
            // The protocol's part overflows u64 at a rate above 100%
            (vault(u64::MAX, u64::MAX, 0, 0), FEE_RATE_DENOMINATOR + 1),
        ],
    );
}

/// Fuzzes `function` over storages and rates near the edges, against the SDK.
fn fuzz_function(context: &TestContext<FuzzMode>, function: Function) {
    fuzz::run(
        context,
        &program(),
        case(function, &fresh(), 0, 0),
        (storages(), fuzz::protocol_fee_rates(), any::<u64>()).prop_map(
            move |(storage, protocol_fee_rate, expected)| AccountingWitness {
                storage,
                protocol_fee_rate,
                expected,
                ..case(function, &fresh(), 0, 0)
            },
        ),
        |witness| {
            if let Some(expected) = model(witness) {
                witness.expected = expected;
            }
        },
        |witness| model(witness).is_some(),
    );
}

#[simplex::fuzz]
fn fuzz_unit_vault_available_lender_shares(context: TestContext<FuzzMode>) {
    fuzz_function(&context, Function::AvailableLenderShares);
}

#[simplex::fuzz]
fn fuzz_unit_vault_available_protocol_fee(context: TestContext<FuzzMode>) {
    fuzz_function(&context, Function::AvailableProtocolFee);
}
