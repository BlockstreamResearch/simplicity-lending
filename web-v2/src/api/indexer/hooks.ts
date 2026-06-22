import {
  type QueryKey,
  useQuery,
  type UseQueryOptions,
  type UseQueryResult,
} from '@tanstack/react-query'

import { STALE_TIME_MS } from '../staleTime'
import {
  fetchBorrowerOffers,
  fetchBorrowerOverview,
  fetchFactoriesByScript,
  fetchFactory,
  fetchLenderOffers,
  fetchLenderOverview,
  fetchOffer,
  fetchOffers,
  fetchOffersOverview,
  type ListOffersParams,
} from './methods'
import { borrowerQueryKeys, factoryQueryKeys, lenderQueryKeys, offersQueryKeys } from './queryKeys'
import type {
  BorrowerOverview,
  FactoryDetails,
  LenderOverview,
  OfferDetails,
  OfferListResponse,
  OffersOverview,
} from './schemas'

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

export function useOffersOverview(
  options: ExtraQueryOptions<OffersOverview> = {},
): UseQueryResult<OffersOverview> {
  return useQuery({
    queryKey: offersQueryKeys.overview(),
    queryFn: ({ signal }) => fetchOffersOverview({ signal }),
    staleTime: options.staleTime ?? STALE_TIME_MS.medium,
    refetchInterval: options.refetchInterval,
    placeholderData: options.placeholderData,
  })
}

export function useBorrowerOverview(
  scriptPubkeyHex: string,
  options: ExtraQueryOptions<BorrowerOverview> = {},
): UseQueryResult<BorrowerOverview> {
  return useQuery({
    queryKey: borrowerQueryKeys.overview(scriptPubkeyHex),
    queryFn: ({ signal }) => fetchBorrowerOverview(scriptPubkeyHex, { signal }),
    staleTime: options.staleTime ?? STALE_TIME_MS.realtime,
    refetchInterval: options.refetchInterval,
    enabled: !!scriptPubkeyHex,
  })
}

export function useBorrowerOffers(
  scriptPubkeyHex: string,
  params: ListOffersParams = {},
  options: ExtraQueryOptions<OfferListResponse> = {},
): UseQueryResult<OfferListResponse> {
  return useQuery({
    queryKey: borrowerQueryKeys.offers(scriptPubkeyHex, params),
    queryFn: ({ signal }) => fetchBorrowerOffers(scriptPubkeyHex, params, { signal }),
    staleTime: options.staleTime ?? STALE_TIME_MS.realtime,
    refetchInterval: options.refetchInterval,
    placeholderData: options.placeholderData,
    enabled: !!scriptPubkeyHex,
  })
}

export function useLenderOverview(
  scriptPubkeyHex: string,
  options: ExtraQueryOptions<LenderOverview> = {},
): UseQueryResult<LenderOverview> {
  return useQuery({
    queryKey: lenderQueryKeys.overview(scriptPubkeyHex),
    queryFn: ({ signal }) => fetchLenderOverview(scriptPubkeyHex, { signal }),
    staleTime: options.staleTime ?? STALE_TIME_MS.realtime,
    refetchInterval: options.refetchInterval,
    enabled: !!scriptPubkeyHex,
  })
}

export function useLenderOffers(
  scriptPubkeyHex: string,
  params: ListOffersParams = {},
  options: ExtraQueryOptions<OfferListResponse> = {},
): UseQueryResult<OfferListResponse> {
  return useQuery({
    queryKey: lenderQueryKeys.offers(scriptPubkeyHex, params),
    queryFn: ({ signal }) => fetchLenderOffers(scriptPubkeyHex, params, { signal }),
    staleTime: options.staleTime ?? STALE_TIME_MS.realtime,
    refetchInterval: options.refetchInterval,
    placeholderData: options.placeholderData,
    enabled: !!scriptPubkeyHex,
  })
}

export function useFactories(
  scriptPubkeyHex: string,
  options: ExtraQueryOptions<FactoryDetails[]> = {},
): UseQueryResult<FactoryDetails[]> {
  return useQuery({
    queryKey: factoryQueryKeys.byScript(scriptPubkeyHex),
    queryFn: ({ signal }) => fetchFactoriesByScript(scriptPubkeyHex, { signal }),
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
