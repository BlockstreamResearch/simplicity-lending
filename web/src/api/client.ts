import type {
  OfferParticipant,
  OfferShort,
  OfferStatus,
  OfferUtxo,
  OfferWithParticipants,
  ParticipantDto,
  ParticipantType,
} from '../types/offers'
import { getApiBaseUrl } from '../config/runtimeConfig'
import { buildConfiguredUrl } from './url'

const API_BASE = getApiBaseUrl()

function buildApiUrl(path: string): string {
  return buildConfiguredUrl(API_BASE, path)
}

/** Parse u64 from JSON (number or string) to bigint; JSON has no native BigInt */
function toBigInt(v: unknown): bigint {
  if (v === null || v === undefined) return 0n
  if (typeof v === 'bigint') return v
  if (typeof v === 'string') return BigInt(v)
  return BigInt(String(Math.floor(Number(v))))
}

function normalizeOffer(raw: Record<string, unknown>): OfferShort {
  return {
    id: String(raw.id ?? ''),
    status: (raw.status as OfferStatus) ?? 'pending',
    collateral_asset: String(raw.collateral_asset ?? ''),
    principal_asset: String(raw.principal_asset ?? ''),
    collateral_amount: toBigInt(raw.collateral_amount),
    principal_amount: toBigInt(raw.principal_amount),
    interest_rate: Number(raw.interest_rate) || 0,
    loan_expiration_time: Number(raw.loan_expiration_time) || 0,
    created_at_height: toBigInt(raw.created_at_height),
    created_at_txid: String(raw.created_at_txid ?? ''),
  }
}

export async function fetchOffers(params?: {
  status?: string
  limit?: number
  offset?: number
}): Promise<OfferShort[]> {
  const url = new URL(buildApiUrl('/offers'))
  if (params?.status) url.searchParams.set('status', params.status)
  if (params?.limit != null) url.searchParams.set('limit', String(params.limit))
  if (params?.offset != null) url.searchParams.set('offset', String(params.offset))

  const res = await fetch(url.toString())
  await throwIfNotOk(res)
  const data: unknown[] = await res.json()
  return data.map((row) => normalizeOffer(row as Record<string, unknown>))
}

async function throwIfNotOk(res: Response): Promise<void> {
  if (res.ok) return
  const contentType = res.headers.get('content-type')
  let body: string
  try {
    body = contentType?.includes('application/json')
      ? JSON.stringify(await res.json())
      : await res.text()
  } catch {
    body = ''
  }
  throw new Error(
    body
      ? `API error: ${res.status} ${res.statusText} — ${body}`
      : `API error: ${res.status} ${res.statusText}`
  )
}

export async function fetchOfferIdsByScript(scriptPubkeyHex: string): Promise<string[]> {
  const url = new URL(buildApiUrl('/offers/by-script'))
  url.searchParams.set('script_pubkey', scriptPubkeyHex)
  const res = await fetch(url.toString())
  await throwIfNotOk(res)
  const data: unknown = await res.json()
  const arr = Array.isArray(data) ? data : []
  return arr.map((id) => String(id))
}

export async function fetchOfferIdsByScripts(scriptPubkeysHex: Iterable<string>): Promise<string[]> {
  const scripts = [...new Set(Array.from(scriptPubkeysHex, (script) => script.trim().toLowerCase()))]
    .filter((script) => script.length > 0)

  if (scripts.length === 0) {
    return []
  }

  const nestedIds = await Promise.all(scripts.map((script) => fetchOfferIdsByScript(script)))
  return [...new Set(nestedIds.flat())]
}

/** Fetch offer IDs where the given key is the borrower (e.g. pending offers created by this user). Expects 32-byte hex (64 chars). */
export async function fetchOfferIdsByBorrowerPubkey(borrowerPubkeyHex: string): Promise<string[]> {
  const hex = borrowerPubkeyHex.trim().toLowerCase().replace(/^0x/, '')
  const url = new URL(buildApiUrl('/offers/by-borrower-pubkey'))
  url.searchParams.set('borrower_pubkey', hex)
  const res = await fetch(url.toString())
  await throwIfNotOk(res)
  const data: unknown = await res.json()
  const arr = Array.isArray(data) ? data : []
  return arr.map((id) => String(id))
}

function normalizeParticipant(raw: Record<string, unknown>): ParticipantDto {
  const pt = raw.participant_type
  const participantType: ParticipantType =
    pt === 'lender' ? 'lender' : pt === 'borrower' ? 'borrower' : 'borrower'
  return {
    offer_id: String(raw.offer_id ?? ''),
    participant_type: participantType,
    script_pubkey: String(raw.script_pubkey ?? ''),
  }
}

function normalizeOfferWithParticipants(raw: Record<string, unknown>): OfferWithParticipants {
  const offer = normalizeOffer(raw)
  const participantsRaw = raw.participants
  const participantsArr = Array.isArray(participantsRaw) ? participantsRaw : []
  const participants = participantsArr.map((p) =>
    normalizeParticipant(p as Record<string, unknown>)
  )
  return { ...offer, participants }
}

export function filterOffersByParticipantRole(
  offers: OfferWithParticipants[],
  scriptPubkeyHex: string,
  role: ParticipantType
): OfferShort[] {
  return filterOffersByParticipantScripts(offers, [scriptPubkeyHex], role)
}

export function filterOffersByParticipantScripts(
  offers: OfferWithParticipants[],
  scriptPubkeysHex: Iterable<string>,
  role: ParticipantType
): OfferShort[] {
  const scripts = new Set(
    Array.from(scriptPubkeysHex, (script) => script.trim().toLowerCase()).filter(
      (script) => script.length > 0
    )
  )

  if (scripts.size === 0) {
    return []
  }

  return offers
    .filter((o) =>
      o.participants.some(
        (p) => p.participant_type === role && scripts.has(p.script_pubkey.trim().toLowerCase())
      )
    )
    .map(
      (o): OfferShort => ({
        id: o.id,
        status: o.status,
        collateral_asset: o.collateral_asset,
        principal_asset: o.principal_asset,
        collateral_amount: o.collateral_amount,
        principal_amount: o.principal_amount,
        interest_rate: o.interest_rate,
        loan_expiration_time: o.loan_expiration_time,
        created_at_height: o.created_at_height,
        created_at_txid: o.created_at_txid,
      })
    )
}

export async function fetchOfferDetailsBatch(ids: string[]): Promise<OfferShort[]> {
  const res = await fetch(buildApiUrl('/offers/batch'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  })
  await throwIfNotOk(res)
  const data: unknown[] = await res.json()
  return data.map((row) => normalizeOffer(row as Record<string, unknown>))
}

export async function fetchOfferDetailsBatchWithParticipants(
  ids: string[]
): Promise<OfferWithParticipants[]> {
  const res = await fetch(buildApiUrl('/offers/batch'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  })
  await throwIfNotOk(res)
  const data: unknown[] = await res.json()
  return data.map((row) => normalizeOfferWithParticipants(row as Record<string, unknown>))
}

function normalizeOfferUtxo(raw: Record<string, unknown>): OfferUtxo {
  return {
    offer_id: String(raw.offer_id ?? ''),
    txid: String(raw.txid ?? ''),
    vout: Number(raw.vout ?? 0),
    utxo_type: (raw.utxo_type as OfferUtxo['utxo_type']) ?? 'pre_lock',
    created_at_height: Number(raw.created_at_height ?? 0),
    spent_txid: raw.spent_txid != null ? String(raw.spent_txid) : null,
    spent_at_height: raw.spent_at_height != null ? Number(raw.spent_at_height) : null,
  }
}

/** Fetch UTXO history for an offer (GET /offers/:id/utxos). Used e.g. to get Lending UTXO for liquidation. */
export async function fetchOfferUtxos(offerId: string): Promise<OfferUtxo[]> {
  const res = await fetch(buildApiUrl(`/offers/${encodeURIComponent(offerId)}/utxos`))
  await throwIfNotOk(res)
  const data: unknown[] = await res.json()
  return data.map((row) => normalizeOfferUtxo(row as Record<string, unknown>))
}

function normalizeOfferParticipant(raw: Record<string, unknown>): OfferParticipant {
  const pt = raw.participant_type
  const participantType: ParticipantType =
    pt === 'lender' ? 'lender' : pt === 'borrower' ? 'borrower' : 'borrower'
  return {
    offer_id: String(raw.offer_id ?? ''),
    participant_type: participantType,
    script_pubkey: String(raw.script_pubkey ?? ''),
    txid: String(raw.txid ?? ''),
    vout: Number(raw.vout ?? 0),
    created_at_height: Number(raw.created_at_height ?? 0),
    spent_txid: raw.spent_txid != null ? String(raw.spent_txid) : null,
    spent_at_height: raw.spent_at_height != null ? Number(raw.spent_at_height) : null,
  }
}

/** Fetch participant movement history (GET /offers/:id/participants/history). Used to get current Lender/Borrower NFT (txid, vout) from indexer. */
export async function fetchOfferParticipantsHistory(offerId: string): Promise<OfferParticipant[]> {
  const res = await fetch(
    buildApiUrl(`/offers/${encodeURIComponent(offerId)}/participants/history`)
  )
  await throwIfNotOk(res)
  const data: unknown[] = await res.json()
  return data.map((row) => normalizeOfferParticipant(row as Record<string, unknown>))
}

/** Current Lender NFT = unspent participant with participant_type 'lender', latest by created_at_height. */
export function getCurrentLenderParticipant(history: OfferParticipant[]): OfferParticipant | null {
  const unspentLenders = history.filter(
    (p) => p.participant_type === 'lender' && p.spent_txid == null
  )
  if (unspentLenders.length === 0) return null
  unspentLenders.sort((a, b) => b.created_at_height - a.created_at_height)
  return unspentLenders[0] ?? null
}

/** Current Borrower NFT = unspent participant with participant_type 'borrower', latest by created_at_height. */
export function getCurrentBorrowerParticipant(
  history: OfferParticipant[]
): OfferParticipant | null {
  const unspentBorrowers = history.filter(
    (p) => p.participant_type === 'borrower' && p.spent_txid == null
  )
  if (unspentBorrowers.length === 0) return null
  unspentBorrowers.sort((a, b) => b.created_at_height - a.created_at_height)
  return unspentBorrowers[0] ?? null
}
