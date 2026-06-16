import { env } from '@/constants/env'
import { normalizeHex } from '@/utils/hex'

import { requestJson, type RequestParams } from '../client'
import {
  type BorrowerDashboard,
  borrowerDashboardSchema,
  type FactoryDetails,
  factoryDetailsSchema,
  factoryListSchema,
  type OfferDetails,
  offerDetailsSchema,
  offerIdListSchema,
  type OfferListResponse,
  offerListResponseSchema,
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
  | 'collateral_amount'
  | 'principal_amount'
  | 'interest_rate'
  | 'loan_expiration_time'

export interface ListOffersParams {
  status?: OfferStatus | OfferStatus[]
  factory_id?: string
  asset?: string
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
  if (params.factory_id) q.factory_id = params.factory_id
  if (params.asset) q.asset = params.asset
  // if (params.limit !== undefined) q.limit = String(params.limit)
  // if (params.offset !== undefined) q.offset = String(params.offset)
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

export async function fetchOfferIdsByScript(
  scriptPubkeyHex: string,
  options: RequestParams = {},
): Promise<string[]> {
  const url = buildSearchUrl('/offers/by-script', {
    script_pubkey: normalizeHex(scriptPubkeyHex),
  })
  return requestJson(url, offerIdListSchema, { signal: options.signal })
}

export async function fetchBorrowerDashboard(
  scriptPubkeyHex: string,
  params: ListOffersParams = {},
  options: RequestParams = {},
): Promise<BorrowerDashboard> {
  const url = buildSearchUrl('/borrowers/by-script', {
    script_pubkey: normalizeHex(scriptPubkeyHex),
    ...toQueryParams(params),
  })
  return requestJson(url, borrowerDashboardSchema, { signal: options.signal })
}

export async function fetchFactories(
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
