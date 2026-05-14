use std::num::TryFromIntError;

pub const MAX_BASIS_POINTS: u64 = 10_000; // 100%

pub fn apply_basis_points(amount: u64, bps: u16) -> Result<u64, TryFromIntError> {
    let amount_wide = u128::from(amount) * u128::from(bps);
    let result = amount_wide / u128::from(MAX_BASIS_POINTS);

    u64::try_from(result)
}
