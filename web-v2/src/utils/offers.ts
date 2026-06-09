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
