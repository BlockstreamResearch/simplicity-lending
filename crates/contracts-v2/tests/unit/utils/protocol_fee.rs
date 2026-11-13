use simplex::fuzz::proptest::prelude::{Strategy, any};
use simplex::{FuzzMode, TestContext};

use lending_contracts_v2::artifacts::tests::utils::protocol_fee::ProtocolFeeProgram;
use lending_contracts_v2::artifacts::tests::utils::protocol_fee::derived_protocol_fee::{
    ProtocolFeeArguments, ProtocolFeeWitness,
};
use lending_contracts_v2::utils::protocol_fee::{FEE_RATE_DENOMINATOR, protocol_fee_part};

use crate::support::{expect, fuzz};

/// The functions of the test program, by the index it selects them with.
#[derive(Clone, Copy)]
enum Function {
    ProtocolFeePart,
    FeeRateDenominator,
}

const FUNCTIONS: u8 = 2;

fn program() -> ProtocolFeeProgram {
    ProtocolFeeProgram::new(ProtocolFeeArguments::default())
}

fn case(function: Function) -> ProtocolFeeWitness {
    ProtocolFeeWitness {
        function_index: function as u8,
        fee_amount: 0,
        fee_rate: 0,
        expected: 0,
    }
}

fn protocol_fee_part_case(fee_amount: u64, fee_rate: u64, expected: u64) -> ProtocolFeeWitness {
    ProtocolFeeWitness {
        fee_amount,
        fee_rate,
        expected,
        ..case(Function::ProtocolFeePart)
    }
}

fn fee_rate_denominator_case(expected: u64) -> ProtocolFeeWitness {
    ProtocolFeeWitness {
        expected,
        ..case(Function::FeeRateDenominator)
    }
}

#[test]
fn rejects_unknown_function() {
    expect::rejects(
        program().as_ref(),
        ProtocolFeeWitness {
            function_index: FUNCTIONS,
            ..fee_rate_denominator_case(FEE_RATE_DENOMINATOR)
        },
    );
}

#[test]
fn fee_rate_denominator_is_one_hundred_percent() {
    let program = program();

    expect::accepts(
        program.as_ref(),
        fee_rate_denominator_case(FEE_RATE_DENOMINATOR),
    );
    expect::rejects(
        program.as_ref(),
        fee_rate_denominator_case(FEE_RATE_DENOMINATOR - 1),
    );
}

#[test]
fn protocol_fee_part_matches_model() {
    let program = program();

    for (fee_amount, fee_rate) in [
        // Nothing to split
        (0, 30_000),
        (1_000, 0),
        // The whole fee
        (1_000, FEE_RATE_DENOMINATOR),
        // Rounds down
        (1, FEE_RATE_DENOMINATOR - 1),
        (10, 15_000),
        (99_999, 1),
        // The product overflows u64, the result does not
        (u64::MAX, FEE_RATE_DENOMINATOR),
        (u64::MAX, 1),
    ] {
        let expected = protocol_fee_part(fee_amount, fee_rate).unwrap();

        expect::accepts(
            program.as_ref(),
            protocol_fee_part_case(fee_amount, fee_rate, expected),
        );
        expect::rejects(
            program.as_ref(),
            protocol_fee_part_case(fee_amount, fee_rate, expected.wrapping_add(1)),
        );
    }
}

#[test]
fn protocol_fee_part_rejects_overflow() {
    let program = program();

    for (fee_amount, fee_rate) in [(u64::MAX, FEE_RATE_DENOMINATOR + 1), (u64::MAX, u64::MAX)] {
        assert_eq!(protocol_fee_part(fee_amount, fee_rate), None);

        expect::rejects(
            program.as_ref(),
            protocol_fee_part_case(fee_amount, fee_rate, u64::MAX),
        );
    }
}

/// Amounts and rates around the edges of the computation, with rates above 100% to reach overflow.
fn protocol_fee_part_cases() -> impl Strategy<Value = ProtocolFeeWitness> {
    (fuzz::amounts(), fuzz::protocol_fee_rates(), any::<u64>()).prop_map(
        |(fee_amount, fee_rate, expected)| protocol_fee_part_case(fee_amount, fee_rate, expected),
    )
}

#[simplex::fuzz]
fn fuzz_unit_protocol_fee_part(context: TestContext<FuzzMode>) {
    fuzz::run(
        &context,
        &program(),
        protocol_fee_part_case(0, 0, 0),
        protocol_fee_part_cases(),
        |witness| {
            witness.expected =
                protocol_fee_part(witness.fee_amount, witness.fee_rate).unwrap_or_default();
        },
        |witness| protocol_fee_part(witness.fee_amount, witness.fee_rate).is_some(),
    );
}
