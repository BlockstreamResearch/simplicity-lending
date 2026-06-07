import type { OfferShort } from '@/api/indexer/schemas'
import type { DisplayStatus } from '@/components/ui/OfferStatusBadge'

// Interest in satoshis. bps = basis points (1000 = 10%, 10000 = 100%).
export function calcInterest(principal: bigint, bps: number): bigint {
  return (principal * BigInt(Math.round(bps))) / 10_000n
}

// Display basis points as human-readable percent string: 1000 → "10.00%"
export function bpsToPercent(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`
}

// Offer enriched with values derived from the current chain tip, ready for display.
export interface DisplayOffer extends OfferShort {
  termLeft: number
  displayStatus: DisplayStatus
  earn: bigint // total interest, precomputed for sorting
}

// Single source of truth for offer → display mapping (used by dashboard + table).
export function toDisplayOffer(offer: OfferShort, currentBlockHeight: number): DisplayOffer {
  const termLeft = offer.loan_expiration_time - currentBlockHeight
  const displayStatus = offer.status === 'pending' && termLeft <= 0 ? 'expired' : offer.status
  return {
    ...offer,
    termLeft,
    displayStatus,
    earn: calcInterest(offer.principal_amount, offer.interest_rate),
  }
}
