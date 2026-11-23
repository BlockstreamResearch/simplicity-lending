use simplex::fuzz::proptest::prelude::any;
use simplex::{FuzzMode, TestContext};

use crate::support::fuzz;
use crate::vault::samples::storages;

use super::case;

// 0. available_lender_shares
#[simplex::fuzz]
fn fuzz_unit_vault_available_lender_shares(context: TestContext<FuzzMode>) {
    fuzz::run(
        &context,
        (storages(), fuzz::protocol_fee_rates(), any::<u64>()),
        |(storage, protocol_fee_rate, expected)| {
            case::available_lender_shares(storage, protocol_fee_rate, expected)
        },
        case::reference,
    );
}

// 1. available_protocol_fee
#[simplex::fuzz]
fn fuzz_unit_vault_available_protocol_fee(context: TestContext<FuzzMode>) {
    fuzz::run(
        &context,
        (storages(), fuzz::protocol_fee_rates(), any::<u64>()),
        |(storage, protocol_fee_rate, expected)| {
            case::available_protocol_fee(storage, protocol_fee_rate, expected)
        },
        case::reference,
    );
}
