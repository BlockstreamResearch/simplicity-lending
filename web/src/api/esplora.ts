/**
 * Esplora HTTP API client for chain data.
 * Mirrors the indexer's EsploraClient (crates/indexer/src/esplora_client.rs).
 * Base URL from env VITE_ESPLORA_BASE_URL.
 * Explorer URL for tx links from VITE_ESPLORA_EXPLORER_URL (optional; falls back to API base URL).
 * Results use default JS types (string, number, string[], Uint8Array).
 */

import { getEsploraApiBaseUrl, getEsploraExplorerBaseUrl } from '../config/runtimeConfig'

/** Default request timeout in milliseconds. */
export const DEFAULT_TIMEOUT_MS = 30_000
export const DEFAULT_ESPLORA_FEE_TARGET_BLOCKS = 1
export const DEFAULT_FEE_RATE_SAT_KVB = 100

function normalizeBaseUrl(value?: string): string | undefined {
  if (typeof value !== 'string' || !value.trim()) {
    return undefined
  }
  return value.trim().replace(/\/+$/, '')
}

function getBaseUrl(): string | undefined {
  return normalizeBaseUrl(getEsploraApiBaseUrl())
}

function getExplorerBaseUrl(apiBaseUrl: string): string {
  const configured = getEsploraExplorerBaseUrl()
  if (typeof configured === 'string' && configured.trim()) {
    return configured.trim().replace(/\/+$/, '')
  }
  return apiBaseUrl
}

function isValidFeeEstimateEntry(target: number, rate: number): boolean {
  return Number.isInteger(target) && target > 0 && Number.isFinite(rate) && rate > 0
}

function parseFeeEstimateEntries(
  estimates: Record<string, number>
): Array<readonly [number, number]> {
  return Object.entries(estimates)
    .map(([target, rate]) => [Number(target), rate] as const)
    .filter(([target, rate]) => isValidFeeEstimateEntry(target, rate))
    .sort(([leftTarget], [rightTarget]) => leftTarget - rightTarget)
}

export function selectFeeRateSatVb(
  estimates: Record<string, number>,
  targetBlocks: number
): number {
  const entries = parseFeeEstimateEntries(estimates)
  if (entries.length === 0) {
    throw new EsploraApiError('No fee estimates available')
  }

  const exactEntry = entries.find(([target]) => target === targetBlocks)
  if (exactEntry) {
    return exactEntry[1]
  }

  const higherTargetEntry = entries.find(([target]) => target > targetBlocks)
  if (higherTargetEntry) {
    return higherTargetEntry[1]
  }

  return entries[0][1]
}

export class EsploraApiError extends Error {
  readonly status: number | undefined
  readonly body: string | undefined
  constructor(message: string, status?: number, body?: string) {
    super(message)
    this.name = 'EsploraApiError'
    this.status = status
    this.body = body
  }
}

/**
 * Esplora API client. Create once with optional baseUrl/timeout, then call methods.
 */
export class EsploraClient {
  private readonly baseUrl: string | undefined
  private readonly explorerBaseUrl: string | undefined
  private readonly timeoutMs: number

  constructor(baseUrl?: string, timeoutMs: number = DEFAULT_TIMEOUT_MS) {
    this.baseUrl = normalizeBaseUrl(baseUrl) || getBaseUrl()
    this.explorerBaseUrl = this.baseUrl ? getExplorerBaseUrl(this.baseUrl) : undefined
    this.timeoutMs = timeoutMs
  }

  private requireBaseUrl(): string {
    if (!this.baseUrl) {
      throw new EsploraApiError('VITE_ESPLORA_BASE_URL is not set')
    }
    return this.baseUrl
  }

  private requireExplorerBaseUrl(): string {
    return this.explorerBaseUrl ?? this.requireBaseUrl()
  }

  private async get(path: string): Promise<string> {
    const url = `${this.requireBaseUrl()}${path}`
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const res = await fetch(url, { signal: controller.signal })
      clearTimeout(timeoutId)
      const body = await res.text()
      if (!res.ok) {
        throw new EsploraApiError(`Esplora API error: ${res.status}`, res.status, body)
      }
      return body
    } catch (e) {
      clearTimeout(timeoutId)
      if (e instanceof EsploraApiError) throw e
      if (e instanceof Error) throw new EsploraApiError(e.message)
      throw new EsploraApiError(String(e))
    }
  }

  private async getBytes(path: string): Promise<Uint8Array> {
    const url = `${this.requireBaseUrl()}${path}`
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const res = await fetch(url, { signal: controller.signal })
      clearTimeout(timeoutId)
      if (!res.ok) {
        const body = await res.text()
        throw new EsploraApiError(`Esplora API error: ${res.status}`, res.status, body)
      }
      const buffer = await res.arrayBuffer()
      return new Uint8Array(buffer)
    } catch (e) {
      clearTimeout(timeoutId)
      if (e instanceof EsploraApiError) throw e
      if (e instanceof Error) throw new EsploraApiError(e.message)
      throw new EsploraApiError(String(e))
    }
  }

  private async post(path: string, body: string): Promise<string> {
    const url = `${this.requireBaseUrl()}${path}`
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body,
        signal: controller.signal,
      })
      clearTimeout(timeoutId)
      const resBody = await res.text()
      if (!res.ok) {
        throw new EsploraApiError(`Esplora API error: ${res.status}`, res.status, resBody)
      }
      return resBody
    } catch (e) {
      clearTimeout(timeoutId)
      if (e instanceof EsploraApiError) throw e
      if (e instanceof Error) throw new EsploraApiError(e.message)
      throw new EsploraApiError(String(e))
    }
  }

  /** POST /tx - broadcast raw transaction (hex). Returns txid on success. */
  async broadcastTx(txHex: string): Promise<string> {
    const body = await this.post('/tx', txHex.trim())
    return body.trim()
  }

  /** URL of the transaction page on the block explorer (e.g. to open in a new tab). Uses VITE_ESPLORA_EXPLORER_URL if set. */
  getTxExplorerUrl(txid: string): string {
    return `${this.requireExplorerBaseUrl()}/tx/${txid.trim()}`
  }

  /** URL of the asset page on the block explorer (e.g. to open in a new tab). */
  getAssetExplorerUrl(assetId: string): string {
    return `${this.requireExplorerBaseUrl()}/asset/${assetId.trim()}`
  }

  /** Latest block hash (tip). */
  async getLatestBlockHash(): Promise<string> {
    const body = await this.get('/blocks/tip/hash')
    return body.trim()
  }

  /** Latest block height (tip). */
  async getLatestBlockHeight(): Promise<number> {
    const body = await this.get('/blocks/tip/height')
    const height = parseInt(body.trim(), 10)
    if (Number.isNaN(height)) throw new EsploraApiError('Invalid height response')
    return height
  }

  /** GET /fee-estimates — confirmation target to fee rate map in sat/vB. */
  async getFeeEstimates(): Promise<Record<string, number>> {
    const body = await this.get('/fee-estimates')
    try {
      const raw = JSON.parse(body) as unknown
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new EsploraApiError('Expected fee estimate object')
      }

      return Object.fromEntries(
        Object.entries(raw).filter(
          ([target, rate]) =>
            Number.isInteger(Number(target)) &&
            Number(target) > 0 &&
            typeof rate === 'number' &&
            Number.isFinite(rate) &&
            rate > 0
        )
      )
    } catch (e) {
      if (e instanceof EsploraApiError) throw e
      throw new EsploraApiError(
        `Failed to parse fee estimates: ${e instanceof Error ? e.message : String(e)}`
      )
    }
  }

  /** Resolve a fee rate for the target in sats/kvB. */
  async getFeeRateSatKvb(targetBlocks: number): Promise<number> {
    const feeRateSatVb = selectFeeRateSatVb(await this.getFeeEstimates(), targetBlocks)
    return feeRateSatVb * 1000
  }

  /** Block hash at a given height. */
  async getBlockHashAtHeight(blockHeight: number): Promise<string> {
    const body = await this.get(`/block-height/${blockHeight}`)
    return body.trim()
  }

  /** List of txids in a block (hex strings). */
  async getBlockTxids(blockHash: string): Promise<string[]> {
    const body = await this.get(`/block/${blockHash}/txids`)
    try {
      const raw = JSON.parse(body) as unknown
      if (!Array.isArray(raw)) throw new EsploraApiError('Expected array of txids')
      return raw.map((s) => String(s))
    } catch (e) {
      if (e instanceof EsploraApiError) throw e
      throw new EsploraApiError(
        `Failed to parse block txids: ${e instanceof Error ? e.message : String(e)}`
      )
    }
  }

  /** Raw transaction bytes by txid (GET /tx/{txid}/raw). */
  async getTxRaw(txId: string): Promise<Uint8Array> {
    return this.getBytes(`/tx/${txId}/raw`)
  }

  /** GET /tx/:txid — full transaction JSON (vin, vout with scriptpubkey, value, asset). */
  async getTx(txId: string): Promise<EsploraTx> {
    const body = await this.get(`/tx/${txId}`)
    try {
      return JSON.parse(body) as EsploraTx
    } catch (e) {
      throw new EsploraApiError(`Failed to parse tx: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  /** GET /tx/:txid/outspends — spending status of all outputs. */
  async getTxOutspends(txId: string): Promise<EsploraOutspend[]> {
    const body = await this.get(`/tx/${txId}/outspends`)
    try {
      const raw = JSON.parse(body) as unknown
      if (!Array.isArray(raw)) throw new EsploraApiError('Expected array')
      return raw as EsploraOutspend[]
    } catch (e) {
      if (e instanceof EsploraApiError) throw e
      throw new EsploraApiError(
        `Failed to parse outspends: ${e instanceof Error ? e.message : String(e)}`
      )
    }
  }

  // --- Scripthash (script_pubkey) — for P2TR and other scripts ---

  /** GET /scripthash/:hash — chain_stats, mempool_stats. */
  async getScripthashInfo(scripthash: string): Promise<ScripthashInfo> {
    const body = await this.get(`/scripthash/${scripthash}`)
    try {
      return JSON.parse(body) as ScripthashInfo
    } catch (e) {
      throw new EsploraApiError(
        `Failed to parse scripthash info: ${e instanceof Error ? e.message : String(e)}`
      )
    }
  }

  /** GET /scripthash/:hash/utxo — unspent outputs. */
  async getScripthashUtxo(scripthash: string): Promise<ScripthashUtxoEntry[]> {
    const body = await this.get(`/scripthash/${scripthash}/utxo`)
    try {
      const raw = JSON.parse(body) as unknown
      if (!Array.isArray(raw)) throw new EsploraApiError('Expected array')
      return raw as ScripthashUtxoEntry[]
    } catch (e) {
      if (e instanceof EsploraApiError) throw e
      throw new EsploraApiError(
        `Failed to parse scripthash utxo: ${e instanceof Error ? e.message : String(e)}`
      )
    }
  }

  /** GET /scripthash/:hash/txs or .../txs/chain/:last_seen_txid — tx history (newest first). */
  async getScripthashTxs(scripthash: string, lastSeenTxid?: string): Promise<ScripthashTxEntry[]> {
    const path =
      lastSeenTxid != null && lastSeenTxid
        ? `/scripthash/${scripthash}/txs/chain/${lastSeenTxid}`
        : `/scripthash/${scripthash}/txs`
    const body = await this.get(path)
    try {
      const raw = JSON.parse(body) as unknown
      if (!Array.isArray(raw)) throw new EsploraApiError('Expected array')
      return raw as ScripthashTxEntry[]
    } catch (e) {
      if (e instanceof EsploraApiError) throw e
      throw new EsploraApiError(
        `Failed to parse scripthash txs: ${e instanceof Error ? e.message : String(e)}`
      )
    }
  }

  // --- Address (same data as scripthash, Esplora accepts bech32 address in path) ---

  /** GET /address/:address — chain_stats, mempool_stats. */
  async getAddressInfo(address: string): Promise<AddressInfo> {
    const path = `/address/${encodeURIComponent(address)}`
    const body = await this.get(path)
    try {
      return JSON.parse(body) as AddressInfo
    } catch (e) {
      throw new EsploraApiError(
        `Failed to parse address info: ${e instanceof Error ? e.message : String(e)}`
      )
    }
  }

  /** GET /address/:address/utxo — unspent outputs. */
  async getAddressUtxo(address: string): Promise<ScripthashUtxoEntry[]> {
    const path = `/address/${encodeURIComponent(address)}/utxo`
    const body = await this.get(path)
    try {
      const raw = JSON.parse(body) as unknown
      if (!Array.isArray(raw)) throw new EsploraApiError('Expected array')
      return raw as ScripthashUtxoEntry[]
    } catch (e) {
      if (e instanceof EsploraApiError) throw e
      throw new EsploraApiError(
        `Failed to parse address utxo: ${e instanceof Error ? e.message : String(e)}`
      )
    }
  }

  /** GET /address/:address/txs or .../txs/chain/:last_seen_txid — tx history (newest first). */
  async getAddressTxs(address: string, lastSeenTxid?: string): Promise<ScripthashTxEntry[]> {
    const prefix = `/address/${encodeURIComponent(address)}`
    const path =
      lastSeenTxid != null && lastSeenTxid ? `${prefix}/txs/chain/${lastSeenTxid}` : `${prefix}/txs`
    const body = await this.get(path)
    try {
      const raw = JSON.parse(body) as unknown
      if (!Array.isArray(raw)) throw new EsploraApiError('Expected array')
      return raw as ScripthashTxEntry[]
    } catch (e) {
      if (e instanceof EsploraApiError) throw e
      throw new EsploraApiError(
        `Failed to parse address txs: ${e instanceof Error ? e.message : String(e)}`
      )
    }
  }
}

// --- Scripthash types (see api-esplora.md) ---

export interface ChainOrMempoolStats {
  tx_count: number
  funded_txo_count: number
  funded_txo_sum?: number
  spent_txo_count: number
  spent_txo_sum?: number
}

export interface ScripthashInfo {
  scripthash: string
  chain_stats: ChainOrMempoolStats
  mempool_stats: ChainOrMempoolStats
}

/** Response of GET /address/:address — same stats as ScripthashInfo. */
export interface AddressInfo {
  address: string
  chain_stats: ChainOrMempoolStats
  mempool_stats: ChainOrMempoolStats
}

export interface ScripthashUtxoEntry {
  txid: string
  vout: number
  value?: number
  valuecommitment?: string
  asset?: string
  assetcommitment?: string
  nonce?: string
  noncecommitment?: string
  status: { confirmed: boolean; block_height?: number; block_hash?: string }
}

export interface ScripthashTxEntry {
  txid: string
  status: { confirmed: boolean; block_height?: number; block_hash?: string }
  [key: string]: unknown
}

/** One output from GET /tx/:txid (vout[]). Elements: value + asset; scriptpubkey as hex string. */
export interface EsploraVout {
  scriptpubkey?: string
  scriptpubkey_hex?: string
  scriptpubkey_address?: string
  value?: number
  valuecommitment?: string
  asset?: string
  assetcommitment?: string
  nonce?: string
  noncecommitment?: string
  [key: string]: unknown
}

/** Full transaction from GET /tx/:txid. */
export interface EsploraTx {
  txid: string
  vout: EsploraVout[]
  vin?: unknown[]
  [key: string]: unknown
}

/** One entry from GET /tx/:txid/outspends. */
export interface EsploraOutspend {
  spent: boolean
  txid?: string
  vin?: number
  status?: { confirmed: boolean }
  [key: string]: unknown
}

export async function resolveWalletFeeRateSatKvb(
  esplora: Pick<EsploraClient, 'getFeeRateSatKvb'>,
  targetBlocks: number = DEFAULT_ESPLORA_FEE_TARGET_BLOCKS,
  fallbackFeeRateSatKvb: number = DEFAULT_FEE_RATE_SAT_KVB
): Promise<number> {
  try {
    return await esplora.getFeeRateSatKvb(targetBlocks)
  } catch {
    return fallbackFeeRateSatKvb
  }
}

/**
 * Hash script_pubkey (hex) to 32-byte script hash (SHA256).
 * Matches Rust hash_script; use this for PreLockArguments script hashes.
 */
export async function hashScriptPubkeyHex(scriptPubkeyHex: string): Promise<Uint8Array> {
  const hex = scriptPubkeyHex.replace(/\s/g, '').toLowerCase()
  if (hex.length % 2 !== 0) throw new EsploraApiError('script_pubkey hex must have even length')
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return new Uint8Array(hash)
}

/**
 * Convert script_pubkey (hex) to Esplora/Electrum API scripthash.
 * Same underlying hash as Rust simplicityhl_core::hash_script (SHA256 of script bytes);
 * Esplora/Electrum represent it as reversed 32-byte hash in hex (see Electrum protocol).
 */
export async function scriptPubkeyToScripthash(scriptPubkeyHex: string): Promise<string> {
  const hashBytes = await hashScriptPubkeyHex(scriptPubkeyHex)
  const arr = new Uint8Array(hashBytes)
  arr.reverse()
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
