import { env } from '@/constants/env'
import { isHexString } from '@/utils/hex'

import { requestBytes, requestJson, type RequestParams, requestText } from '../client'
import { ApiError } from '../errors'
import {
  type AddressInfo,
  addressInfoSchema,
  blockHeightTextSchema,
  type EsploraOutspend,
  esploraOutspendListSchema,
  type EsploraTx,
  esploraTxSchema,
  type ScriptHashTxEntry,
  scriptHashTxListSchema,
  type ScriptHashUtxoEntry,
  scriptHashUtxoListSchema,
  txIdListSchema,
} from './schemas'

function buildEsploraUrl(path: string): string {
  return `${env.VITE_ESPLORA_BASE_URL}/api${path}`
}

type Resource = 'address' | 'scripthash'

function buildResourcePath(kind: Resource, identifier: string): string {
  return kind === 'address'
    ? `/address/${encodeURIComponent(identifier)}`
    : `/scripthash/${identifier}`
}

function buildTxsHistoryPath(basePath: string, lastSeenTxId?: string): string {
  return lastSeenTxId ? `${basePath}/txs/chain/${lastSeenTxId}` : `${basePath}/txs`
}

export async function fetchTx(txId: string, options: RequestParams = {}): Promise<EsploraTx> {
  return requestJson(buildEsploraUrl(`/tx/${txId}`), esploraTxSchema, { signal: options.signal })
}

export async function fetchTxRaw(txId: string, options: RequestParams = {}): Promise<Uint8Array> {
  return requestBytes(buildEsploraUrl(`/tx/${txId}/raw`), { signal: options.signal })
}

export async function fetchTxOutspends(
  txId: string,
  options: RequestParams = {},
): Promise<EsploraOutspend[]> {
  return requestJson(buildEsploraUrl(`/tx/${txId}/outspends`), esploraOutspendListSchema, {
    signal: options.signal,
  })
}

export async function broadcastTx(txHex: string, options: RequestParams = {}): Promise<string> {
  const trimmedHex = txHex.trim()
  if (!isHexString(trimmedHex)) {
    throw new ApiError('broadcastTx: txHex must be a non-empty hex string with even length')
  }
  return requestText(buildEsploraUrl('/tx'), {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    data: trimmedHex,
    signal: options.signal,
  })
}

export async function fetchLatestBlockHash(options: RequestParams = {}): Promise<string> {
  return requestText(buildEsploraUrl('/blocks/tip/hash'), { signal: options.signal })
}

export async function fetchLatestBlockHeight(options: RequestParams = {}): Promise<number> {
  return requestText(buildEsploraUrl('/blocks/tip/height'), blockHeightTextSchema, {
    signal: options.signal,
  })
}

export async function fetchBlockHashAtHeight(
  blockHeight: number,
  options: RequestParams = {},
): Promise<string> {
  return requestText(buildEsploraUrl(`/block-height/${blockHeight}`), { signal: options.signal })
}

export async function fetchBlockTxIds(
  blockHash: string,
  options: RequestParams = {},
): Promise<string[]> {
  return requestJson(buildEsploraUrl(`/block/${blockHash}/txids`), txIdListSchema, {
    signal: options.signal,
  })
}

async function fetchResourceInfo(
  kind: Resource,
  identifier: string,
  options: RequestParams,
): Promise<AddressInfo> {
  const url = buildEsploraUrl(buildResourcePath(kind, identifier))
  return requestJson(url, addressInfoSchema, { signal: options.signal })
}

async function fetchResourceUtxos(
  kind: Resource,
  identifier: string,
  options: RequestParams,
): Promise<ScriptHashUtxoEntry[]> {
  const url = buildEsploraUrl(`${buildResourcePath(kind, identifier)}/utxo`)
  return requestJson(url, scriptHashUtxoListSchema, { signal: options.signal })
}

async function fetchResourceTxs(
  kind: Resource,
  identifier: string,
  lastSeenTxId: string | undefined,
  options: RequestParams,
): Promise<ScriptHashTxEntry[]> {
  const basePath = buildResourcePath(kind, identifier)
  const url = buildEsploraUrl(buildTxsHistoryPath(basePath, lastSeenTxId))
  return requestJson(url, scriptHashTxListSchema, { signal: options.signal })
}

export async function fetchAddressInfo(
  address: string,
  options: RequestParams = {},
): Promise<AddressInfo> {
  return fetchResourceInfo('address', address, options)
}

export async function fetchAddressUtxo(
  address: string,
  options: RequestParams = {},
): Promise<ScriptHashUtxoEntry[]> {
  return fetchResourceUtxos('address', address, options)
}

export async function fetchAddressTxs(
  address: string,
  lastSeenTxId?: string,
  options: RequestParams = {},
): Promise<ScriptHashTxEntry[]> {
  return fetchResourceTxs('address', address, lastSeenTxId, options)
}

export async function fetchScriptHashInfo(
  scriptHash: string,
  options: RequestParams = {},
): Promise<AddressInfo> {
  return fetchResourceInfo('scripthash', scriptHash, options)
}

export async function fetchScriptHashUtxo(
  scriptHash: string,
  options: RequestParams = {},
): Promise<ScriptHashUtxoEntry[]> {
  return fetchResourceUtxos('scripthash', scriptHash, options)
}

export async function fetchScriptHashTxs(
  scriptHash: string,
  lastSeenTxId?: string,
  options: RequestParams = {},
): Promise<ScriptHashTxEntry[]> {
  return fetchResourceTxs('scripthash', scriptHash, lastSeenTxId, options)
}
