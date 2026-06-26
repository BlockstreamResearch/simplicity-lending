import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { useOffer } from '@/api/indexer/hooks'
import { offersQueryKeys } from '@/api/indexer/queryKeys'
import type { OfferShort } from '@/api/indexer/schemas'
import { useWallet } from '@/providers/wallet/useWallet'

const OFFER_ID_PARAM = 'offer-id'

function withOfferId(params: URLSearchParams, id: string | null) {
  const next = new URLSearchParams(params)
  void (id ? next.set(OFFER_ID_PARAM, id) : next.delete(OFFER_ID_PARAM))
  return next
}

export function useOpenOffer() {
  const queryClient = useQueryClient()
  const [, setSearchParams] = useSearchParams()

  const openOffer = useCallback(
    (offer: OfferShort) => {
      queryClient.setQueryData(offersQueryKeys.detail(offer.id), offer)
      setSearchParams(prev => withOfferId(prev, offer.id))
    },
    [queryClient, setSearchParams],
  )

  return { openOffer }
}

export function useOfferModal() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { connectionStatus, reconnecting } = useWallet()
  const offerId = searchParams.get(OFFER_ID_PARAM) ?? ''

  const { data: offer = null, isError } = useOffer(offerId)

  const [lastOffer, setLastOffer] = useState(offer)
  const isOpen = offer !== null && connectionStatus !== 'locked' && !reconnecting

  if (offer !== null && offer !== lastOffer) setLastOffer(offer)

  const close = useCallback(() => {
    setSearchParams(prev => withOfferId(prev, null), { replace: true })
  }, [setSearchParams])

  useEffect(() => {
    if (isError && !offer) close()
  }, [isError, offer, close])

  return { offer, lastOffer, isError: Boolean(offerId) && isError, close, isOpen }
}
