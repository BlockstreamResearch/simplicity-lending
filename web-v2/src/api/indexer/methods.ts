import { env } from '@/constants/env'
import { normalizeHex } from '@/utils/hex'

import { requestJson, type RequestParams } from '../client'
import {
  type BorrowerOverview,
  borrowerOverviewSchema,
  type FactoryDetails,
  factoryDetailsSchema,
  factoryListSchema,
  type LenderOverview,
  lenderOverviewSchema,
  type OfferDetails,
  offerDetailsSchema,
  type OfferListResponse,
  offerListResponseSchema,
  type OffersOverview,
  offersOverviewSchema,
  type OfferStatus,
} from './schemas'

function buildOfferUrl(offerId: string, suffix = ''): string {
  return `${env.VITE_API_URL}/offers/${encodeURIComponent(offerId)}${suffix}`
}

function buildSearchUrl(path: string, params: Record<string, string>): string {
  const query = new URLSearchParams(params).toString()
  return query ? `${env.VITE_API_URL}${path}?${query}` : `${env.VITE_API_URL}${path}`
}

export type SortDir = 'asc' | 'desc'

export type SortField =
  | 'created_at_height'
  | 'collateral_amount'
  | 'principal_amount'
  | 'interest_rate'
  | 'loan_expiration_height'

export interface ListOffersParams {
  status?: OfferStatus | OfferStatus[]
  factoryId?: string
  collateralAsset?: string
  principalAsset?: string
  limit?: number
  offset?: number
  sortBy?: SortField
  sortDir?: SortDir
}

function toQueryParams(params: ListOffersParams): Record<string, string> {
  const q: Record<string, string> = {}
  if (params.status) {
    q.status = Array.isArray(params.status) ? params.status.join(',') : params.status
  }
  if (params.factoryId) q.factory_id = params.factoryId
  if (params.collateralAsset) q.collateral_asset = params.collateralAsset
  if (params.principalAsset) q.principal_asset = params.principalAsset
  if (params.limit !== undefined) q.limit = String(params.limit)
  if (params.offset !== undefined) q.offset = String(params.offset)
  if (params.sortBy) q.sort_by = params.sortBy
  if (params.sortDir) q.sort_dir = params.sortDir
  return q
}

export async function fetchOffers(
  params: ListOffersParams = {},
  options: RequestParams = {},
): Promise<OfferListResponse> {
  return requestJson(buildSearchUrl('/offers', toQueryParams(params)), offerListResponseSchema, {
    signal: options.signal,
  })
}

export async function fetchOffer(
  offerId: string,
  options: RequestParams = {},
): Promise<OfferDetails> {
  return requestJson(buildOfferUrl(offerId), offerDetailsSchema, { signal: options.signal })
}

export async function fetchOffersOverview(options: RequestParams = {}): Promise<OffersOverview> {
  return requestJson(`${env.VITE_API_URL}/offers/overview`, offersOverviewSchema, {
    signal: options.signal,
  })
}

export async function fetchBorrowerOverview(
  scriptPubkeyHex: string,
  options: RequestParams = {},
): Promise<BorrowerOverview> {
  const url = buildSearchUrl('/borrowers/overview', {
    script_pubkey: normalizeHex(scriptPubkeyHex),
  })
  return requestJson(url, borrowerOverviewSchema, { signal: options.signal })
}

export async function fetchBorrowerOffers(
  scriptPubkeyHex: string,
  params: ListOffersParams = {},
  options: RequestParams = {},
): Promise<OfferListResponse> {
  const url = buildSearchUrl('/borrowers/offers', {
    script_pubkey: normalizeHex(scriptPubkeyHex),
    ...toQueryParams(params),
  })
  return requestJson(url, offerListResponseSchema, { signal: options.signal })
}

export async function fetchLenderOverview(
  scriptPubkeyHex: string,
  options: RequestParams = {},
): Promise<LenderOverview> {
  const url = buildSearchUrl('/lenders/overview', {
    script_pubkey: normalizeHex(scriptPubkeyHex),
  })
  return requestJson(url, lenderOverviewSchema, { signal: options.signal })
}

export async function fetchLenderOffers(
  scriptPubkeyHex: string,
  params: ListOffersParams = {},
  options: RequestParams = {},
): Promise<OfferListResponse> {
  const url = buildSearchUrl('/lenders/offers', {
    script_pubkey: normalizeHex(scriptPubkeyHex),
    ...toQueryParams(params),
  })
  return requestJson(url, offerListResponseSchema, { signal: options.signal })
}

export async function fetchFactoriesByScript(
  scriptPubkeyHex: string,
  options: RequestParams = {},
): Promise<FactoryDetails[]> {
  const url = buildSearchUrl('/factories/by-script', {
    script_pubkey: normalizeHex(scriptPubkeyHex),
  })
  return requestJson(url, factoryListSchema, { signal: options.signal })
}

export async function fetchFactory(
  factoryId: string,
  options: RequestParams = {},
): Promise<FactoryDetails> {
  return requestJson(
    `${env.VITE_API_URL}/factories/${encodeURIComponent(factoryId)}`,
    factoryDetailsSchema,
    { signal: options.signal },
  )
}
