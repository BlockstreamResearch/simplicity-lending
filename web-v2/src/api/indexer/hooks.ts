import {
  type QueryKey,
  useQuery,
  type UseQueryOptions,
  type UseQueryResult,
} from '@tanstack/react-query'

import { GC_TIME_MS, STALE_TIME_MS } from '../staleTime'
import {
  fetchOffer,
  fetchOfferIdsByBorrowerPubkey,
  fetchOfferIdsByScript,
  fetchOfferParticipants,
  fetchOfferParticipantsHistory,
  fetchOffers,
  fetchOffersBatch,
  fetchOfferUtxos,
  type ListOffersParams,
} from './methods'
import { offersQueryKeys } from './queryKeys'
import type { OfferDetails, OfferParticipant, OfferShort, OfferUtxo } from './schemas'

export interface ExtraQueryOptions<T = unknown> {
  refetchInterval?: number
  staleTime?: number
  placeholderData?: UseQueryOptions<T, Error, T, QueryKey>['placeholderData']
}

export function useOffers(
  params: ListOffersParams = {},
  options: ExtraQueryOptions<OfferShort[]> = {},
): UseQueryResult<OfferShort[]> {
  return useQuery({
    queryKey: offersQueryKeys.list(params),
    queryFn: ({ signal }) => fetchOffers(params, { signal }),
    staleTime: options.staleTime ?? STALE_TIME_MS.medium,
    refetchInterval: options.refetchInterval,
    placeholderData: options.placeholderData,
  })
}

// Fetch offers by exact id list (POST /offers/batch). Use for the user's own
// offers, where the id set is known and must be resolved fully — unlike the
// paginated `useOffers`, which only returns one page.
export function useOffersBatch(
  ids: string[],
  options: ExtraQueryOptions<OfferDetails[]> = {},
): UseQueryResult<OfferDetails[]> {
  return useQuery({
    queryKey: offersQueryKeys.batch(ids),
    queryFn: ({ signal }) => fetchOffersBatch(ids, { signal }),
    staleTime: options.staleTime ?? STALE_TIME_MS.realtime,
    refetchInterval: options.refetchInterval,
    enabled: ids.length > 0,
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

export function useOfferIdsByScript(
  scriptPubkeyHex: string,
  options: ExtraQueryOptions<string[]> = {},
): UseQueryResult<string[]> {
  return useQuery({
    queryKey: offersQueryKeys.byScript(scriptPubkeyHex),
    queryFn: ({ signal }) => fetchOfferIdsByScript(scriptPubkeyHex, { signal }),
    staleTime: options.staleTime ?? STALE_TIME_MS.realtime,
    refetchInterval: options.refetchInterval,
    enabled: !!scriptPubkeyHex,
  })
}

export function useOfferIdsByBorrowerPubkey(
  borrowerPubkeyHex: string,
  options: ExtraQueryOptions<string[]> = {},
): UseQueryResult<string[]> {
  return useQuery({
    queryKey: offersQueryKeys.byBorrower(borrowerPubkeyHex),
    queryFn: ({ signal }) => fetchOfferIdsByBorrowerPubkey(borrowerPubkeyHex, { signal }),
    staleTime: options.staleTime ?? STALE_TIME_MS.realtime,
    refetchInterval: options.refetchInterval,
    enabled: !!borrowerPubkeyHex,
  })
}
