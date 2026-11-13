use simplex::either::Either::{Left, Right};
use simplex::fuzz::proptest::prelude::{Just, Strategy, any, prop_oneof};
use simplex::fuzz::{Expect, FuzzProgramValues, Scenario};
use simplex::{FuzzMode, TestContext};

use lending_contracts_v2::artifacts::tests::utils::protocol_fee::ProtocolFeeProgram;
use lending_contracts_v2::artifacts::tests::utils::protocol_fee::derived_protocol_fee::{
    ProtocolFeeArguments, ProtocolFeeWitness,
};

use crate::support;

const FEE_RATE_DENOMINATOR: u64 = 100_000;

/// The protocol's part of `fee_amount` at `fee_rate`, rounded down. `None` when it overflows u64.
fn protocol_fee_part(fee_amount: u64, fee_rate: u64) -> Option<u64> {
    let part = u128::from(fee_amount) * u128::from(fee_rate) / u128::from(FEE_RATE_DENOMINATOR);

    u64::try_from(part).ok()
}

fn program() -> ProtocolFeeProgram {
    ProtocolFeeProgram::new(ProtocolFeeArguments::default())
}

fn protocol_fee_part_case(fee_amount: u64, fee_rate: u64, expected: u64) -> ProtocolFeeWitness {
    ProtocolFeeWitness {
        case: Left((fee_amount, fee_rate, expected)),
    }
}

#[test]
fn fee_rate_denominator_is_one_hundred_percent() {
    let program = program();
    let case = |expected| ProtocolFeeWitness {
        case: Right(expected),
    };

    support::accepts(program.as_ref(), case(FEE_RATE_DENOMINATOR));
    support::rejects(program.as_ref(), case(FEE_RATE_DENOMINATOR - 1));
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

        support::accepts(
            program.as_ref(),
            protocol_fee_part_case(fee_amount, fee_rate, expected),
        );
        support::rejects(
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

        support::rejects(
            program.as_ref(),
            protocol_fee_part_case(fee_amount, fee_rate, u64::MAX),
        );
    }
}

/// Amounts and rates around the edges of the computation, with rates above 100% to reach overflow.
fn protocol_fee_part_values() -> impl Strategy<Value = FuzzProgramValues> {
    let fee_amounts = prop_oneof![Just(0), Just(u64::MAX), 0..=10_000_000_000u64, any::<u64>()];
    let fee_rates = prop_oneof![
        Just(0),
        Just(FEE_RATE_DENOMINATOR),
        0..=FEE_RATE_DENOMINATOR,
        any::<u64>(),
    ];

    (fee_amounts, fee_rates, any::<u64>()).prop_map(|(fee_amount, fee_rate, expected)| {
        (
            ProtocolFeeArguments::default().into(),
            protocol_fee_part_case(fee_amount, fee_rate, expected).into(),
        )
            .into()
    })
}

#[simplex::fuzz]
fn fuzz_unit_protocol_fee_part(context: TestContext<FuzzMode>) {
    let program = program();
    let template = protocol_fee_part_case(0, 0, 0);

    let mut scenario = Scenario::new(support::spend(
        program.as_ref(),
        template,
        *context.get_network(),
    ));

    scenario
        .add::<ProtocolFeeProgram>("protocol_fee")
        .spends(0)
        .custom_strategy(protocol_fee_part_values())
        // The witness carries the model's result, and the program must reject any other value
        .requires_witness(|witness, _| {
            if let Left((fee_amount, fee_rate, expected)) = &mut witness.case {
                *expected = protocol_fee_part(*fee_amount, *fee_rate).unwrap_or_default();
            }
        });

    context
        .engine(scenario)
        .spec(|case| {
            let Left((fee_amount, fee_rate, _)) = case
                .program::<ProtocolFeeProgram>("protocol_fee")
                .witness()
                .case
            else {
                unreachable!("the strategy only generates protocol fee part cases");
            };

            match protocol_fee_part(fee_amount, fee_rate) {
                Some(_) => Expect::Accept,
                None => Expect::Reject,
            }
        })
        .run();
}
