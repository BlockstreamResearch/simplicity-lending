use simplex::fuzz::proptest::prelude::any;
use simplex::{FuzzMode, TestContext};

use crate::support::fuzz;

use super::case;

// 0. get_protocol_fee_part
/// Amounts and rates around the edges of the computation, with rates above 100% to reach overflow.
#[simplex::fuzz]
fn fuzz_unit_protocol_fee_part(context: TestContext<FuzzMode>) {
    fuzz::run(
        &context,
        (fuzz::amounts(), fuzz::protocol_fee_rates(), any::<u64>()),
        |(fee_amount, fee_rate, expected)| case::protocol_fee_part(fee_amount, fee_rate, expected),
        case::reference,
    );
}
