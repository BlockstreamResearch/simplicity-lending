import { z } from 'zod'

import { env } from '@/constants/env'
import { normalizeHex } from '@/utils/hex'

import {
  type OfferDetails,
  offerDetailsSchema,
  type OfferFull,
  offerFullSchema,
  offerIdListSchema,
  type OfferParticipant,
  offerParticipantSchema,
  type OfferShort,
  offerShortSchema,
  type OfferStatus,
  type OfferUtxo,
  offerUtxoSchema,
  type ParticipantType,
} from './schemas'
import { requestJson, type RequestParams } from './transport'

const offerShortListSchema = z.array(offerShortSchema)
const offerFullListSchema = z.array(offerFullSchema)
const offerDetailsListSchema = z.array(offerDetailsSchema)
const offerUtxoListSchema = z.array(offerUtxoSchema)
const offerParticipantListSchema = z.array(offerParticipantSchema)

function indexerBaseUrl(): string {
  return env.VITE_API_URL.replace(/\/+$/, '')
}

function buildOfferUrl(offerId: string, suffix = ''): string {
  return `${indexerBaseUrl()}/offers/${encodeURIComponent(offerId)}${suffix}`
}

function buildSearchUrl(path: string, params: Record<string, string>): string {
  const query = new URLSearchParams(params).toString()
  return query ? `${indexerBaseUrl()}${path}?${query}` : `${indexerBaseUrl()}${path}`
}

function postBatch<Schema extends z.ZodTypeAny>(
  schema: Schema,
  ids: string[],
  options: RequestParams,
): Promise<z.output<Schema>> {
  return requestJson(`${indexerBaseUrl()}/offers/batch`, schema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
    signal: options.signal,
  })
}

export interface ListOffersParams {
  status?: OfferStatus | string
  asset?: string
  limit?: number
  offset?: number
}

export async function fetchOffers(
  params: ListOffersParams = {},
  options: RequestParams = {},
): Promise<OfferShort[]> {
  const queryParams: Record<string, string> = {}
  if (params.status) queryParams.status = params.status
  if (params.asset) queryParams.asset = params.asset
  if (params.limit !== undefined) queryParams.limit = String(params.limit)
  if (params.offset !== undefined) queryParams.offset = String(params.offset)
  return requestJson(buildSearchUrl('/offers', queryParams), offerShortListSchema, {
    signal: options.signal,
  })
}

export async function fetchOffersFull(
  params: ListOffersParams = {},
  options: RequestParams = {},
): Promise<OfferFull[]> {
  const queryParams: Record<string, string> = {}
  if (params.status) queryParams.status = params.status
  if (params.asset) queryParams.asset = params.asset
  if (params.limit !== undefined) queryParams.limit = String(params.limit)
  if (params.offset !== undefined) queryParams.offset = String(params.offset)
  return requestJson(buildSearchUrl('/offers/full', queryParams), offerFullListSchema, {
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

export function filterOfferDetailsByParticipantRole(
  offers: OfferDetails[],
  scriptPubkeyHex: string,
  role: ParticipantType,
): OfferDetails[] {
  const targetScript = normalizeHex(scriptPubkeyHex)
  return offers.filter(offer =>
    offer.participants.some(
      participant =>
        participant.participant_type === role &&
        normalizeHex(participant.script_pubkey) === targetScript,
    ),
  )
}

export function getCurrentParticipantByRole(
  history: OfferParticipant[],
  role: ParticipantType,
): OfferParticipant | null {
  const unspentEntries = history.filter(
    participant => participant.participant_type === role && participant.spent_txid === null,
  )
  if (unspentEntries.length === 0) return null
  const sortedByHeight = [...unspentEntries].sort(
    (left, right) => right.created_at_height - left.created_at_height,
  )
  return sortedByHeight[0] ?? null
}

export function getCurrentLenderParticipant(history: OfferParticipant[]): OfferParticipant | null {
  return getCurrentParticipantByRole(history, 'lender')
}

export function getCurrentBorrowerParticipant(
  history: OfferParticipant[],
): OfferParticipant | null {
  return getCurrentParticipantByRole(history, 'borrower')
}
