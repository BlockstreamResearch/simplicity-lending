use std::num::TryFromIntError;

pub const MAX_BASIS_POINTS: u64 = 10_000; // 100%

/// Calculates `floor(x * y / denominator)` with a 128-bit intermediate product.
/// Mirrors `mul_div_64` from the SimplicityHL std used by the Lending covenant.
///
/// # Panics
/// Panics if `denominator` is zero.
pub fn mul_div(x: u64, y: u64, denominator: u64) -> Result<u64, TryFromIntError> {
    let product = u128::from(x) * u128::from(y);

    u64::try_from(product / u128::from(denominator))
}

pub fn apply_basis_points(amount: u64, bps: u16) -> Result<u64, TryFromIntError> {
    mul_div(amount, u64::from(bps), MAX_BASIS_POINTS)
}

pub fn basis_points_of(whole: u64, part: u64) -> Result<u16, TryFromIntError> {
    let result = u128::from(part) * u128::from(MAX_BASIS_POINTS) / u128::from(whole);

    u16::try_from(result)
}
