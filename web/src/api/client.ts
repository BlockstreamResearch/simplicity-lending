import type {
  OfferShort,
  OfferStatus,
  OfferWithParticipants,
  ParticipantDto,
  ParticipantType,
} from '../types/offers'

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

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
  const url = new URL(`${API_BASE}/offers`)
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
  const url = new URL(`${API_BASE}/offers/by-script`)
  url.searchParams.set('script_pubkey', scriptPubkeyHex)
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
  const scriptLower = scriptPubkeyHex.trim().toLowerCase()
  return offers
    .filter((o) =>
      o.participants.some(
        (p) => p.participant_type === role && p.script_pubkey.trim().toLowerCase() === scriptLower
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
  const res = await fetch(`${API_BASE}/offers/batch`, {
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
  const res = await fetch(`${API_BASE}/offers/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  })
  await throwIfNotOk(res)
  const data: unknown[] = await res.json()
  return data.map((row) => normalizeOfferWithParticipants(row as Record<string, unknown>))
}
