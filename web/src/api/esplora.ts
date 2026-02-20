/**
 * Esplora HTTP API client for chain data.
 * Mirrors the indexer's EsploraClient (crates/indexer/src/esplora_client.rs).
 * Base URL from env VITE_ESPLORA_BASE_URL (required).
 * Results use default JS types (string, number, string[], Uint8Array).
 */

/** Default request timeout in milliseconds. */
export const DEFAULT_TIMEOUT_MS = 30_000

function getBaseUrl(): string {
  const env = import.meta.env.VITE_ESPLORA_BASE_URL
  if (typeof env !== 'string' || !env.trim()) {
    throw new EsploraApiError('VITE_ESPLORA_BASE_URL is not set')
  }
  return env.trim().replace(/\/+$/, '')
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
  private readonly baseUrl: string
  private readonly timeoutMs: number

  constructor(
    baseUrl?: string,
    timeoutMs: number = DEFAULT_TIMEOUT_MS
  ) {
    this.baseUrl =
      (baseUrl?.trim() && baseUrl.trim().replace(/\/+$/, '')) || getBaseUrl()
    this.timeoutMs = timeoutMs
  }

  private async get(path: string): Promise<string> {
    const url = `${this.baseUrl}${path}`
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const res = await fetch(url, { signal: controller.signal })
      clearTimeout(timeoutId)
      const body = await res.text()
      if (!res.ok) {
        throw new EsploraApiError(
          `Esplora API error: ${res.status}`,
          res.status,
          body
        )
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
    const url = `${this.baseUrl}${path}`
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const res = await fetch(url, { signal: controller.signal })
      clearTimeout(timeoutId)
      if (!res.ok) {
        const body = await res.text()
        throw new EsploraApiError(
          `Esplora API error: ${res.status}`,
          res.status,
          body
        )
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
  async getScripthashTxs(
    scripthash: string,
    lastSeenTxid?: string
  ): Promise<ScripthashTxEntry[]> {
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
  async getAddressTxs(
    address: string,
    lastSeenTxid?: string
  ): Promise<ScripthashTxEntry[]> {
    const prefix = `/address/${encodeURIComponent(address)}`
    const path =
      lastSeenTxid != null && lastSeenTxid
        ? `${prefix}/txs/chain/${lastSeenTxid}`
        : `${prefix}/txs`
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

/**
 * Convert script_pubkey (hex) to Esplora/Electrum API scripthash.
 * Same underlying hash as Rust simplicityhl_core::hash_script (SHA256 of script bytes);
 * Esplora/Electrum represent it as reversed 32-byte hash in hex (see Electrum protocol).
 */
export async function scriptPubkeyToScripthash(scriptPubkeyHex: string): Promise<string> {
  const hex = scriptPubkeyHex.replace(/\s/g, '').toLowerCase()
  if (hex.length % 2 !== 0) throw new EsploraApiError('script_pubkey hex must have even length')
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  const arr = new Uint8Array(hash)
  arr.reverse()
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
