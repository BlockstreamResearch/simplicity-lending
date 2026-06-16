import {
  type QueryKey,
  useQuery,
  type UseQueryOptions,
  type UseQueryResult,
} from '@tanstack/react-query'

import { STALE_TIME_MS } from '../staleTime'
import {
  fetchBorrowerDashboard,
  fetchFactories,
  fetchFactory,
  fetchOffer,
  fetchOfferIdsByScript,
  fetchOffers,
  type ListOffersParams,
} from './methods'
import { borrowerQueryKeys, factoryQueryKeys, offersQueryKeys } from './queryKeys'
import type { BorrowerDashboard, FactoryDetails, OfferDetails, OfferListResponse } from './schemas'

export interface ExtraQueryOptions<T = unknown> {
  refetchInterval?: number
  staleTime?: number
  placeholderData?: UseQueryOptions<T, Error, T, QueryKey>['placeholderData']
}

export function useOffers(
  params: ListOffersParams = {},
  options: ExtraQueryOptions<OfferListResponse> = {},
): UseQueryResult<OfferListResponse> {
  return useQuery({
    queryKey: offersQueryKeys.list(params),
    queryFn: ({ signal }) => fetchOffers(params, { signal }),
    staleTime: options.staleTime ?? STALE_TIME_MS.medium,
    refetchInterval: options.refetchInterval,
    placeholderData: options.placeholderData,
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

export function useBorrowerDashboard(
  scriptPubkeyHex: string,
  params: ListOffersParams = {},
  options: ExtraQueryOptions<BorrowerDashboard> = {},
): UseQueryResult<BorrowerDashboard> {
  return useQuery({
    queryKey: borrowerQueryKeys.dashboard(scriptPubkeyHex, params),
    queryFn: ({ signal }) => fetchBorrowerDashboard(scriptPubkeyHex, params, { signal }),
    staleTime: options.staleTime ?? STALE_TIME_MS.realtime,
    refetchInterval: options.refetchInterval,
    enabled: !!scriptPubkeyHex,
  })
}

export function useFactories(
  scriptPubkeyHex: string,
  options: ExtraQueryOptions<FactoryDetails[]> = {},
): UseQueryResult<FactoryDetails[]> {
  return useQuery({
    queryKey: factoryQueryKeys.byScript(scriptPubkeyHex),
    queryFn: ({ signal }) => fetchFactories(scriptPubkeyHex, { signal }),
    staleTime: options.staleTime ?? STALE_TIME_MS.realtime,
    refetchInterval: options.refetchInterval,
    enabled: !!scriptPubkeyHex,
  })
}

export function useFactory(
  factoryId: string,
  options: ExtraQueryOptions<FactoryDetails> = {},
): UseQueryResult<FactoryDetails> {
  return useQuery({
    queryKey: factoryQueryKeys.detail(factoryId),
    queryFn: ({ signal }) => fetchFactory(factoryId, { signal }),
    staleTime: options.staleTime ?? STALE_TIME_MS.realtime,
    enabled: !!factoryId,
  })
}
