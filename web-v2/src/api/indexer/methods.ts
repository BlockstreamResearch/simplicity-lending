import { z } from 'zod'

import { env } from '@/constants/env'
import { normalizeHex } from '@/utils/hex'

import { requestJson, type RequestParams } from '../transport'
import {
  type OfferDetails,
  offerDetailsListSchema,
  offerDetailsSchema,
  type OfferFull,
  offerFullListSchema,
  offerIdListSchema,
  type OfferParticipant,
  offerParticipantListSchema,
  type OfferShort,
  offerShortListSchema,
  type OfferStatus,
  type OfferUtxo,
  offerUtxoListSchema,
} from './schemas'

function buildOfferUrl(offerId: string, suffix = ''): string {
  return `${env.VITE_API_URL}/offers/${encodeURIComponent(offerId)}${suffix}`
}

function buildSearchUrl(path: string, params: Record<string, string>): string {
  const query = new URLSearchParams(params).toString()
  return query ? `${env.VITE_API_URL}${path}?${query}` : `${env.VITE_API_URL}${path}`
}

function postBatch<Schema extends z.ZodTypeAny>(
  schema: Schema,
  ids: string[],
  options: RequestParams,
): Promise<z.output<Schema>> {
  return requestJson(`${env.VITE_API_URL}/offers/batch`, schema, {
    method: 'POST',
    data: { ids },
    signal: options.signal,
  })
}

export interface ListOffersParams {
  status?: OfferStatus
  asset?: string
  limit?: number
  offset?: number
}

function toQueryParams(params: ListOffersParams): Record<string, string> {
  const queryParams: Record<string, string> = {}
  if (params.status) queryParams.status = params.status
  if (params.asset) queryParams.asset = params.asset
  if (params.limit !== undefined) queryParams.limit = String(params.limit)
  if (params.offset !== undefined) queryParams.offset = String(params.offset)
  return queryParams
}

export async function fetchOffers(
  params: ListOffersParams = {},
  options: RequestParams = {},
): Promise<OfferShort[]> {
  return requestJson(buildSearchUrl('/offers', toQueryParams(params)), offerShortListSchema, {
    signal: options.signal,
  })
}

export async function fetchOffersFull(
  params: ListOffersParams = {},
  options: RequestParams = {},
): Promise<OfferFull[]> {
  return requestJson(buildSearchUrl('/offers/full', toQueryParams(params)), offerFullListSchema, {
    signal: options.signal,
  })
}

export async function fetchOffer(
  offerId: string,
  options: RequestParams = {},
): Promise<OfferDetails> {
  return requestJson(buildOfferUrl(offerId), offerDetailsSchema, { signal: options.signal })
}

export async function fetchOfferUtxos(
  offerId: string,
  options: RequestParams = {},
): Promise<OfferUtxo[]> {
  return requestJson(buildOfferUrl(offerId, '/utxos'), offerUtxoListSchema, {
    signal: options.signal,
  })
}

export async function fetchOfferParticipants(
  offerId: string,
  options: RequestParams = {},
): Promise<OfferParticipant[]> {
  return requestJson(buildOfferUrl(offerId, '/participants'), offerParticipantListSchema, {
    signal: options.signal,
  })
}

export async function fetchOfferParticipantsHistory(
  offerId: string,
  options: RequestParams = {},
): Promise<OfferParticipant[]> {
  return requestJson(buildOfferUrl(offerId, '/participants/history'), offerParticipantListSchema, {
    signal: options.signal,
  })
}

export async function fetchOffersBatch(
  ids: string[],
  options: RequestParams = {},
): Promise<OfferDetails[]> {
  return postBatch(offerDetailsListSchema, ids, options)
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

export async function fetchOfferIdsByBorrowerPubkey(
  borrowerPubkeyHex: string,
  options: RequestParams = {},
): Promise<string[]> {
  const url = buildSearchUrl('/offers/by-borrower-pubkey', {
    borrower_pubkey: normalizeHex(borrowerPubkeyHex),
  })
  return requestJson(url, offerIdListSchema, { signal: options.signal })
}
