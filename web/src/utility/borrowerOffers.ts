import { filterOffersByParticipantScripts } from '../api/client'
import type { OfferShort, OfferWithParticipants } from '../types/offers'

export interface BorrowStatsSummary {
  lockedLbtc: bigint
  activeDeals: number
  pendingDeals: number
}

function normalizeOfferId(offerId: string): string {
  return offerId.trim().toLowerCase()
}

function stripParticipants(offer: OfferWithParticipants): OfferShort {
  const { participants, ...offerWithoutParticipants } = offer
  void participants
  return offerWithoutParticipants
}

function sortOffersByHeightDesc(offers: OfferShort[]): OfferShort[] {
  return [...offers].sort((left, right) => {
    if (left.created_at_height === right.created_at_height) {
      return left.id.localeCompare(right.id)
    }
    return left.created_at_height > right.created_at_height ? -1 : 1
  })
}

export function mergeBorrowerOffers(params: {
  detailedOffers: OfferWithParticipants[]
  knownScripts: Iterable<string>
  trackedOfferIds: Iterable<string>
  pendingBorrowerPubkeyOfferIds: Iterable<string>
}): OfferShort[] {
  const mergedById = new Map<string, OfferShort>()

  for (const offer of filterOffersByParticipantScripts(
    params.detailedOffers,
    params.knownScripts,
    'borrower'
  )) {
    mergedById.set(normalizeOfferId(offer.id), offer)
  }

  const trackedIds = new Set(
    [...params.trackedOfferIds, ...params.pendingBorrowerPubkeyOfferIds]
      .map(normalizeOfferId)
      .filter((offerId) => offerId.length > 0)
  )

  for (const offer of params.detailedOffers) {
    const normalizedOfferId = normalizeOfferId(offer.id)
    if (!trackedIds.has(normalizedOfferId) || mergedById.has(normalizedOfferId)) {
      continue
    }
    mergedById.set(normalizedOfferId, stripParticipants(offer))
  }

  return sortOffersByHeightDesc([...mergedById.values()])
}

export function summarizeBorrowerOffers(offers: OfferShort[]): BorrowStatsSummary {
  const activeBorrowOffers = offers.filter((offer) => offer.status === 'active')
  return {
    lockedLbtc: activeBorrowOffers.reduce((sum, offer) => sum + offer.collateral_amount, 0n),
    activeDeals: activeBorrowOffers.length,
    pendingDeals: offers.filter((offer) => offer.status === 'pending').length,
  }
}
