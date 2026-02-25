/**
 * Encode lending parameters for Utility NFTs (First and Second Parameters NFT amounts).
 * Mirrors crates/contracts/src/sdk/parameters.rs bitfield layout.
 */

const POWERS_OF_10: bigint[] = [
  1n,
  10n,
  100n,
  1_000n,
  10_000n,
  100_000n,
  1_000_000n,
  10_000_000n,
  100_000_000n,
  1_000_000_000n,
  10_000_000_000n,
  100_000_000_000n,
  1_000_000_000_000n,
  10_000_000_000_000n,
  100_000_000_000_000n,
  1_000_000_000_000_000n,
]

const MAX_25_BIT = 0x1_ff_ff_ff // 33_554_431
const MAX_27_BIT = 0x7_ff_ff_ff // 134_217_727

/** 1% = 100 basis points, 100% = 10000. */
export function percentToBasisPoints(percent: number): number {
  return Math.round(Number(percent) * 100)
}

/**
 * Convert amount to base amount: amount / 10^decimals.
 * Result must fit u32 and 25 bits (for Second NFT params).
 */
export function toBaseAmount(amount: bigint, decimals: number): number {
  if (decimals < 0 || decimals > 15) throw new Error('Decimals must be 0–15')
  const multiplier = POWERS_OF_10[decimals]!
  const result = Number(amount / multiplier)
  if (result > 0xffff_ffff) throw new Error('Base amount exceeds u32')
  if (result > MAX_25_BIT) throw new Error('Base amount exceeds 25-bit limit')
  return result
}

/**
 * Encode First NFT parameters → u64 (LE) for first_parameters_nft_amount.
 * interest_rate: u16 (basis points), loan_expiration_time: u32 (27 bit),
 * collateral_dec, principal_dec: u8 (4 bits each).
 */
export function encodeFirstNFTParameters(
  interestRateBasisPoints: number,
  loanExpirationTime: number,
  collateralDec: number,
  principalDec: number
): bigint {
  if (interestRateBasisPoints < 0 || interestRateBasisPoints > 0xffff) {
    throw new Error('Interest rate must fit u16')
  }
  if (loanExpirationTime < 0 || loanExpirationTime > MAX_27_BIT) {
    throw new Error('Loan expiration time must fit 27 bits')
  }
  if (collateralDec < 0 || collateralDec > 15 || principalDec < 0 || principalDec > 15) {
    throw new Error('Decimals must be 0–15')
  }
  const v =
    (interestRateBasisPoints & 0xffff) |
    ((loanExpirationTime & 0x07_ff_ff_ff) << 16) |
    ((collateralDec & 0x0f) << 43) |
    ((principalDec & 0x0f) << 47)
  return BigInt(v)
}

/**
 * Encode Second NFT parameters → u64 (LE) for second_parameters_nft_amount.
 * collateral_base_amount, principal_base_amount: u32 (25 bits each).
 */
export function encodeSecondNFTParameters(
  collateralBaseAmount: number,
  principalBaseAmount: number
): bigint {
  if (collateralBaseAmount < 0 || collateralBaseAmount > MAX_25_BIT) {
    throw new Error('Collateral base amount must fit 25 bits')
  }
  if (principalBaseAmount < 0 || principalBaseAmount > MAX_25_BIT) {
    throw new Error('Principal base amount must fit 25 bits')
  }
  const v = (collateralBaseAmount & MAX_25_BIT) | ((principalBaseAmount & MAX_25_BIT) << 25)
  return BigInt(v)
}
