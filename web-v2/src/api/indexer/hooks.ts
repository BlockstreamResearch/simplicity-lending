import { useQuery, type UseQueryResult } from '@tanstack/react-query'

import { GC_TIME_MS, STALE_TIME_MS } from '../staleTime'
import {
  fetchOffer,
  fetchOfferIdsByBorrowerPubkey,
  fetchOfferIdsByScript,
  fetchOfferParticipants,
  fetchOfferParticipantsHistory,
  fetchOffers,
  fetchOfferUtxos,
  type ListOffersParams,
} from './methods'
import { offersQueryKeys } from './queryKeys'
import type { OfferDetails, OfferParticipant, OfferShort, OfferUtxo } from './schemas'

export function useOffers(params: ListOffersParams = {}): UseQueryResult<OfferShort[]> {
  return useQuery({
    queryKey: offersQueryKeys.list(params),
    queryFn: ({ signal }) => fetchOffers(params, { signal }),
    staleTime: STALE_TIME_MS.medium,
  })
}

export function useOffer(offerId: string): UseQueryResult<OfferDetails> {
  return useQuery({
    queryKey: offersQueryKeys.detail(offerId),
    queryFn: ({ signal }) => fetchOffer(offerId, { signal }),
    staleTime: STALE_TIME_MS.realtime,
    enabled: !!offerId,
  })
}

export function useOfferUtxos(offerId: string): UseQueryResult<OfferUtxo[]> {
  return useQuery({
    queryKey: offersQueryKeys.utxos(offerId),
    queryFn: ({ signal }) => fetchOfferUtxos(offerId, { signal }),
    staleTime: STALE_TIME_MS.realtime,
    enabled: !!offerId,
  })
}

export function useOfferParticipants(offerId: string): UseQueryResult<OfferParticipant[]> {
  return useQuery({
    queryKey: offersQueryKeys.participants(offerId),
    queryFn: ({ signal }) => fetchOfferParticipants(offerId, { signal }),
    staleTime: STALE_TIME_MS.realtime,
    enabled: !!offerId,
  })
}

export function useOfferParticipantsHistory(offerId: string): UseQueryResult<OfferParticipant[]> {
  return useQuery({
    queryKey: offersQueryKeys.participantsHistory(offerId),
    queryFn: ({ signal }) => fetchOfferParticipantsHistory(offerId, { signal }),
    staleTime: STALE_TIME_MS.realtime,
    gcTime: GC_TIME_MS.long,
    enabled: !!offerId,
  })
}

export function useOfferIdsByScript(scriptPubkeyHex: string): UseQueryResult<string[]> {
  return useQuery({
    queryKey: offersQueryKeys.byScript(scriptPubkeyHex),
    queryFn: ({ signal }) => fetchOfferIdsByScript(scriptPubkeyHex, { signal }),
    staleTime: STALE_TIME_MS.realtime,
    enabled: !!scriptPubkeyHex,
  })
}

export function useOfferIdsByBorrowerPubkey(borrowerPubkeyHex: string): UseQueryResult<string[]> {
  return useQuery({
    queryKey: offersQueryKeys.byBorrower(borrowerPubkeyHex),
    queryFn: ({ signal }) => fetchOfferIdsByBorrowerPubkey(borrowerPubkeyHex, { signal }),
    staleTime: STALE_TIME_MS.realtime,
    enabled: !!borrowerPubkeyHex,
  })
}
