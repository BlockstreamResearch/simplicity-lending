use lending_contracts_v2::utils::protocol_fee::FEE_RATE_DENOMINATOR;

use crate::support::case::DispatchCase;
use crate::support::expect::Rejection::Assertion;

use super::case;

#[test]
fn rejects_unknown_function() {
    case::fee_rate_denominator(FEE_RATE_DENOMINATOR)
        .unknown_function()
        .rejects(Assertion);
}

// 0. get_protocol_fee_part
#[test]
fn protocol_fee_part_matches_sdk() {
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
        let case = case::protocol_fee_part_reference(fee_amount, fee_rate);

        assert!(case.sdk_accepts());

        case.accepts();
        case.off_by_one().rejects(Assertion);
    }
}

/// The result does not fit u64 at a rate above 100%.
#[test]
fn protocol_fee_part_rejects_overflow() {
    for (fee_amount, fee_rate) in [(u64::MAX, FEE_RATE_DENOMINATOR + 1), (u64::MAX, u64::MAX)] {
        let case = case::protocol_fee_part(fee_amount, fee_rate, u64::MAX);

        assert!(!case.sdk_accepts());

        case.rejects(Assertion);
    }
}

// 1. fee_rate_denominator
#[test]
fn fee_rate_denominator_is_one_hundred_percent() {
    case::fee_rate_denominator(FEE_RATE_DENOMINATOR).accepts();
    case::fee_rate_denominator(FEE_RATE_DENOMINATOR - 1).rejects(Assertion);
}
