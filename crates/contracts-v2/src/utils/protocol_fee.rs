/// The fee rate that stands for 100%.
pub const FEE_RATE_DENOMINATOR: u64 = 100_000;

/// The protocol's part of `fee_amount` at `fee_rate`, rounded down, as the contracts compute it.
///
/// `None` when the part does not fit in u64, where the contracts fail.
#[must_use]
pub fn protocol_fee_part(fee_amount: u64, fee_rate: u64) -> Option<u64> {
    let part = u128::from(fee_amount) * u128::from(fee_rate) / u128::from(FEE_RATE_DENOMINATOR);

    u64::try_from(part).ok()
}
