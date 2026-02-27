/**
 * Unit tests for fromBaseAmount and buildLendingParamsFromParameterNFTs.
 * Values aligned with Rust tests in crates/contracts/src/pre_lock/mod.rs (e.g. collateral_amount 10000, principal 4000, decimals 2).
 */

import { describe, it, expect } from 'vitest'
import {
  fromBaseAmount,
  buildLendingParamsFromParameterNFTs,
  encodeFirstNFTParameters,
  encodeSecondNFTParameters,
} from './parametersEncoding'

describe('fromBaseAmount', () => {
  it('multiplies base amount by 10^decimals', () => {
    expect(fromBaseAmount(100, 2)).toBe(10_000n)
    expect(fromBaseAmount(40, 2)).toBe(4_000n)
    expect(fromBaseAmount(1, 0)).toBe(1n)
    expect(fromBaseAmount(1, 15)).toBe(1_000_000_000_000_000n)
  })

  it('throws for decimals out of range', () => {
    expect(() => fromBaseAmount(1, -1)).toThrow('Decimals must be 0–15')
    expect(() => fromBaseAmount(1, 16)).toThrow('Decimals must be 0–15')
  })

  it('throws when result exceeds Liquid 51-bit limit', () => {
    expect(() => fromBaseAmount(2_100_000_000_000_001, 0)).toThrow('Liquid 51-bit limit')
  })
})

describe('buildLendingParamsFromParameterNFTs', () => {
  it('derives lending params matching Rust test (10000 collateral, 4000 principal, 100 expiry, 250 bp)', () => {
    // Same as Rust: amounts_decimals = 2, collateral_amount = 10000, principal_amount = 4000, loan_expiration_time = 100, principal_interest_rate = 250
    const firstAmount = encodeFirstNFTParameters(250, 100, 2, 2)
    const secondAmount = encodeSecondNFTParameters(100, 40) // to_base_amount(10000,2)=100, to_base_amount(4000,2)=40
    const params = buildLendingParamsFromParameterNFTs(firstAmount, secondAmount)
    expect(params.collateralAmount).toBe(10_000n)
    expect(params.principalAmount).toBe(4_000n)
    expect(params.loanExpirationTime).toBe(100)
    expect(params.principalInterestRate).toBe(250)
  })

  it('round-trips with encode then decode', () => {
    const firstAmount = encodeFirstNFTParameters(100, 500, 1, 3)
    const secondAmount = encodeSecondNFTParameters(1000, 2000)
    const params = buildLendingParamsFromParameterNFTs(firstAmount, secondAmount)
    expect(params.collateralAmount).toBe(10_000n) // 1000 * 10^1
    expect(params.principalAmount).toBe(2_000_000n) // 2000 * 10^3
    expect(params.loanExpirationTime).toBe(500)
    expect(params.principalInterestRate).toBe(100)
  })
})
