import type { OfferShort } from '../types/offers'

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
    ...raw,
    id: String(raw.id),
    collateral_amount: toBigInt(raw.collateral_amount),
    principal_amount: toBigInt(raw.principal_amount),
    created_at_height: toBigInt(raw.created_at_height),
  } as OfferShort
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
  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`)
  const data: unknown[] = await res.json()
  return data.map((row) => normalizeOffer(row as Record<string, unknown>))
}
