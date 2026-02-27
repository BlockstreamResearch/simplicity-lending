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
const MAX_25_BIT_N = 0x1_ff_ff_ffn
const MAX_27_BIT_N = 0x7_ff_ff_ffn
/** Liquid 51-bit amount limit (mirrors MAX_LIQUID_AMOUNT in parameters.rs). */
const MAX_LIQUID_AMOUNT = 2_100_000_000_000_000n

/** 1% = 100 basis points, 100% = 10000. */
export function percentToBasisPoints(percent: number): number {
  return Math.round(Number(percent) * 100)
}

/**
 * Convert amount from base amount using the passed decimal mantissa.
 * Mirrors from_base_amount in crates/contracts/src/sdk/parameters.rs.
 */
export function fromBaseAmount(baseAmount: number, decimals: number): bigint {
  if (decimals < 0 || decimals > 15) throw new Error('Decimals must be 0–15')
  const multiplier = POWERS_OF_10[decimals]!
  const result = BigInt(baseAmount) * multiplier
  if (result > MAX_LIQUID_AMOUNT) {
    throw new Error('Resulting amount exceeds Liquid 51-bit limit')
  }
  return result
}

/**
 * Build lending parameters from first and second Parameter NFT amounts.
 * Mirrors LendingParameters::build_from_parameters_nfts in parameters.rs.
 */
export function buildLendingParamsFromParameterNFTs(
  firstNFTAmount: bigint,
  secondNFTAmount: bigint
): {
  collateralAmount: bigint
  principalAmount: bigint
  loanExpirationTime: number
  principalInterestRate: number
} {
  const first = decodeFirstNFTParameters(firstNFTAmount)
  const second = decodeSecondNFTParameters(secondNFTAmount)
  return {
    collateralAmount: fromBaseAmount(second.collateralBaseAmount, first.collateralDec),
    principalAmount: fromBaseAmount(second.principalBaseAmount, first.principalDec),
    loanExpirationTime: first.loanExpirationTime,
    principalInterestRate: first.interestRateBasisPoints,
  }
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
  // Use BigInt so bitwise result is u64; number | and << are 32-bit signed and overflow.
  const v =
    (BigInt(interestRateBasisPoints) & 0xffffn) |
    ((BigInt(loanExpirationTime) & MAX_27_BIT_N) << 16n) |
    ((BigInt(collateralDec) & 0x0fn) << 43n) |
    ((BigInt(principalDec) & 0x0fn) << 47n)
  return v
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
  // Use BigInt so bitwise result is u64; number | and << are 32-bit signed and overflow.
  const v =
    (BigInt(collateralBaseAmount) & MAX_25_BIT_N) |
    ((BigInt(principalBaseAmount) & MAX_25_BIT_N) << 25n)
  return v
}

/** Decode first_parameters_nft_amount (u64) back to parameters. */
export function decodeFirstNFTParameters(amount: bigint): {
  interestRateBasisPoints: number
  loanExpirationTime: number
  collateralDec: number
  principalDec: number
} {
  const v = amount & 0xffff_ffff_ffff_ffffn
  return {
    interestRateBasisPoints: Number(v & 0xffffn),
    loanExpirationTime: Number((v >> 16n) & MAX_27_BIT_N),
    collateralDec: Number((v >> 43n) & 0x0fn),
    principalDec: Number((v >> 47n) & 0x0fn),
  }
}

/** Decode second_parameters_nft_amount (u64) back to base amounts. */
export function decodeSecondNFTParameters(amount: bigint): {
  collateralBaseAmount: number
  principalBaseAmount: number
} {
  const v = amount & 0xffff_ffff_ffff_ffffn
  return {
    collateralBaseAmount: Number(v & MAX_25_BIT_N),
    principalBaseAmount: Number((v >> 25n) & MAX_25_BIT_N),
  }
}
