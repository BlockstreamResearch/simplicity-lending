import type { OfferShort, OfferStatus } from '@/api/indexer/schemas'

// `expired` is a derived display state (a pending offer past its expiration
// height), not a backend status — so it lives here, not in the API enum.
export type OfferDisplayStatus = OfferStatus | 'expired'

// Interest in satoshis. bps = basis points (1000 = 10%, 10000 = 100%).
export function calcInterest(principal: bigint, bps: number): bigint {
  return (principal * BigInt(Math.round(bps))) / 10_000n
}

export function bpsToPercent(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`
}

const BLOCKS_PER_DAY = 1440
const BLOCKS_PER_YEAR = 525_600

export function daysToBlocks(days: number): number {
  return days * BLOCKS_PER_DAY
}

export function feeToBps(feeBaseUnits: bigint, principalBaseUnits: bigint): number {
  if (principalBaseUnits <= 0n) return 0
  return Number((feeBaseUnits * 10_000n) / principalBaseUnits)
}

export function computeApr(bps: number, loanDurationBlocks: number): number {
  if (loanDurationBlocks <= 0) return 0
  return (bps / 10_000) * (BLOCKS_PER_YEAR / loanDurationBlocks) * 100
}

export function computeLtv(
  principalDisplay: number,
  collateralDisplay: number,
  collateralUsd: number | null,
): number | null {
  if (collateralUsd === null || collateralDisplay <= 0) return null
  return principalDisplay / (collateralDisplay * collateralUsd)
}

// Blocks remaining until the offer's loan expires (negative once past).
export function getOfferTermLeft(offer: OfferShort, currentBlockHeight: number): number {
  return offer.loan_expiration_time - currentBlockHeight
}

export function getOfferDisplayStatus(
  offer: OfferShort,
  currentBlockHeight: number,
): OfferDisplayStatus {
  return offer.status === 'pending' && getOfferTermLeft(offer, currentBlockHeight) <= 0
    ? 'expired'
    : offer.status
}
