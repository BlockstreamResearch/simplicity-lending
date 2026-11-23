use lending_contracts_v2::utils::protocol_fee::FEE_RATE_DENOMINATOR;

use crate::support::case::DispatchCase;
use crate::support::expect::Rejection::{Assertion, PrunedBranch};
use crate::vault::samples::fresh;

use super::case::{self, vault};

const TEN_PERCENT: u64 = FEE_RATE_DENOMINATOR / 10;

#[test]
fn rejects_unknown_function() {
    case::available_lender_shares_reference(&fresh(), TEN_PERCENT)
        .unknown_function()
        .rejects(Assertion);
}

// 0. available_lender_shares
#[test]
fn available_lender_shares_matches_sdk() {
    for (storage, protocol_fee_rate) in [
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
    ] {
        let case = case::available_lender_shares_reference(&storage, protocol_fee_rate);

        assert!(case.sdk_accepts());

        case.accepts();
        case.off_by_one().rejects(Assertion);
    }
}

#[test]
fn available_lender_shares_rejects_inconsistent_state() {
    for (storage, protocol_fee_rate, reason) in [
        // The lender withdrew more than the share
        (vault(1_000, 100, 991, 0), TEN_PERCENT, PrunedBranch),
        // The protocol's part is more than the supplied amount
        (vault(500, 1_000, 0, 0), FEE_RATE_DENOMINATOR, PrunedBranch),
        // The protocol's part overflows u64 at a rate above 100%
        (
            vault(u64::MAX, u64::MAX, 0, 0),
            FEE_RATE_DENOMINATOR + 1,
            Assertion,
        ),
    ] {
        let case = case::available_lender_shares_reference(&storage, protocol_fee_rate);

        assert!(!case.sdk_accepts());

        case.rejects(reason);
    }
}

// 1. available_protocol_fee
#[test]
fn available_protocol_fee_matches_sdk() {
    for (storage, protocol_fee_rate) in [
        (vault(0, 0, 0, 0), TEN_PERCENT),
        (vault(1_000, 100, 0, 0), TEN_PERCENT),
        // The harvester withdrew the whole fee
        (vault(1_000, 100, 0, 10), TEN_PERCENT),
        // The protocol's part is taken from all the fee supplied, rounded down once
        (vault(1_000, 15, 0, 0), TEN_PERCENT),
        (vault(1_000, 100, 0, 0), FEE_RATE_DENOMINATOR),
        (vault(1_000, 100, 0, 0), 0),
        (vault(u64::MAX, u64::MAX, 0, 0), FEE_RATE_DENOMINATOR),
    ] {
        let case = case::available_protocol_fee_reference(&storage, protocol_fee_rate);

        assert!(case.sdk_accepts());

        case.accepts();
        case.off_by_one().rejects(Assertion);
    }
}

#[test]
fn available_protocol_fee_rejects_inconsistent_state() {
    for (storage, protocol_fee_rate, reason) in [
        // The harvester withdrew more than the protocol's part
        (vault(1_000, 100, 0, 11), TEN_PERCENT, PrunedBranch),
        // The protocol's part overflows u64 at a rate above 100%
        (
            vault(u64::MAX, u64::MAX, 0, 0),
            FEE_RATE_DENOMINATOR + 1,
            Assertion,
        ),
    ] {
        let case = case::available_protocol_fee_reference(&storage, protocol_fee_rate);

        assert!(!case.sdk_accepts());

        case.rejects(reason);
    }
}
