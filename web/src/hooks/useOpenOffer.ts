import { useCallback } from 'react'
import { generatePath, useNavigate } from 'react-router-dom'

import type { OfferShort } from '@/api/indexer/schemas'
import { RoutePath } from '@/constants/routes'

export function useOpenOffer() {
  const navigate = useNavigate()

  const openOffer = useCallback(
    (offer: OfferShort) => navigate(generatePath(RoutePath.Offer, { offerId: offer.id })),
    [navigate],
  )

  return { openOffer }
}
