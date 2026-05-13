import { useQuery, type UseQueryResult } from '@tanstack/react-query'

import {
  fetchOffer,
  fetchOfferIdsByBorrowerPubkey,
  fetchOfferIdsByScript,
  fetchOfferParticipants,
  fetchOfferParticipantsHistory,
  fetchOffers,
  fetchOfferUtxos,
  type ListOffersParams,
} from '../indexer'
import { queryKeys } from '../queryKeys'
import type { OfferDetails, OfferParticipant, OfferShort, OfferUtxo } from '../schemas'
import { GC_TIME_MS, STALE_TIME_MS } from './staleTime'

export function useOffers(params: ListOffersParams = {}): UseQueryResult<OfferShort[]> {
  return useQuery({
    queryKey: queryKeys.offers.list(params),
    queryFn: ({ signal }) => fetchOffers(params, { signal }),
    staleTime: STALE_TIME_MS.medium,
  })
}

export function useOffer(offerId: string): UseQueryResult<OfferDetails> {
  return useQuery({
    queryKey: queryKeys.offers.detail(offerId),
    queryFn: ({ signal }) => fetchOffer(offerId, { signal }),
    staleTime: STALE_TIME_MS.realtime,
    enabled: !!offerId,
  })
}

export function useOfferUtxos(offerId: string): UseQueryResult<OfferUtxo[]> {
  return useQuery({
    queryKey: queryKeys.offers.utxos(offerId),
    queryFn: ({ signal }) => fetchOfferUtxos(offerId, { signal }),
    staleTime: STALE_TIME_MS.realtime,
    enabled: !!offerId,
  })
}

export function useOfferParticipants(offerId: string): UseQueryResult<OfferParticipant[]> {
  return useQuery({
    queryKey: queryKeys.offers.participants(offerId),
    queryFn: ({ signal }) => fetchOfferParticipants(offerId, { signal }),
    staleTime: STALE_TIME_MS.realtime,
    enabled: !!offerId,
  })
}

export function useOfferParticipantsHistory(offerId: string): UseQueryResult<OfferParticipant[]> {
  return useQuery({
    queryKey: queryKeys.offers.participantsHistory(offerId),
    queryFn: ({ signal }) => fetchOfferParticipantsHistory(offerId, { signal }),
    staleTime: STALE_TIME_MS.realtime,
    gcTime: GC_TIME_MS.long,
    enabled: !!offerId,
  })
}

export function useOfferIdsByScript(scriptPubkeyHex: string): UseQueryResult<string[]> {
  return useQuery({
    queryKey: queryKeys.offers.byScript(scriptPubkeyHex),
    queryFn: ({ signal }) => fetchOfferIdsByScript(scriptPubkeyHex, { signal }),
    staleTime: STALE_TIME_MS.realtime,
    enabled: !!scriptPubkeyHex,
  })
}

export function useOfferIdsByBorrowerPubkey(borrowerPubkeyHex: string): UseQueryResult<string[]> {
  return useQuery({
    queryKey: queryKeys.offers.byBorrower(borrowerPubkeyHex),
    queryFn: ({ signal }) => fetchOfferIdsByBorrowerPubkey(borrowerPubkeyHex, { signal }),
    staleTime: STALE_TIME_MS.realtime,
    enabled: !!borrowerPubkeyHex,
  })
}
