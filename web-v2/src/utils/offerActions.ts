import type { OfferShort } from '@/api/indexer/schemas'

export type OfferAction = 'accept' | 'cancel' | 'repay' | 'liquidate' | 'claim' | 'none'
export type ViewerRole = 'lender' | 'borrower'

export function resolveOfferActionFromShort(
  offer: OfferShort,
  viewerRole: ViewerRole,
  currentBlockHeight: number,
): OfferAction {
  const isExpired = currentBlockHeight >= offer.loan_expiration_height

  switch (viewerRole) {
    case 'lender':
      if (offer.status === 'pending') return 'accept'
      if (offer.status === 'active' && isExpired) return 'liquidate'
      if (offer.status === 'repaid') return 'claim'
      return 'none'
    case 'borrower':
      if (offer.status === 'pending') return 'cancel'
      if (offer.status === 'active') return 'repay'
      return 'none'
  }
}
