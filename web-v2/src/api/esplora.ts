import { z } from 'zod'

import { env } from '@/constants/env'
import { bytesToHex, hexToBytes, isHexString } from '@/utils/hex'

import { ApiError } from './errors'
import {
  type AddressInfo,
  addressInfoSchema,
  type EsploraOutspend,
  esploraOutspendSchema,
  type EsploraTx,
  esploraTxSchema,
  type ScripthashTxEntry,
  scripthashTxEntrySchema,
  type ScripthashUtxoEntry,
  scripthashUtxoEntrySchema,
} from './schemas'
import { requestBytes, requestJson, type RequestParams, requestText } from './transport'

const txidListSchema = z.array(z.string())
const utxoListSchema = z.array(scripthashUtxoEntrySchema)
const txListSchema = z.array(scripthashTxEntrySchema)
const outspendsListSchema = z.array(esploraOutspendSchema)

function buildEsploraUrl(path: string): string {
  return `${env.VITE_ESPLORA_BASE_URL}${path}`
}

function buildExplorerUrl(path: string): string {
  return `${env.VITE_ESPLORA_EXPLORER_URL}${path}`
}

type Resource = 'address' | 'scripthash'

function buildResourcePath(kind: Resource, identifier: string): string {
  return kind === 'address'
    ? `/address/${encodeURIComponent(identifier)}`
    : `/scripthash/${identifier}`
}

function buildTxsHistoryPath(basePath: string, lastSeenTxid?: string): string {
  return lastSeenTxid ? `${basePath}/txs/chain/${lastSeenTxid}` : `${basePath}/txs`
}

export function getTxExplorerUrl(txid: string): string {
  return buildExplorerUrl(`/tx/${txid.trim()}`)
}

export function getAssetExplorerUrl(assetId: string): string {
  return buildExplorerUrl(`/asset/${assetId.trim()}`)
}

export function getAddressExplorerUrl(address: string): string {
  return buildExplorerUrl(`/address/${address.trim()}`)
}

export async function getTx(txid: string, options: RequestParams = {}): Promise<EsploraTx> {
  return requestJson(buildEsploraUrl(`/tx/${txid}`), esploraTxSchema, { signal: options.signal })
}

export async function getTxRaw(txid: string, options: RequestParams = {}): Promise<Uint8Array> {
  return requestBytes(buildEsploraUrl(`/tx/${txid}/raw`), { signal: options.signal })
}

export async function getTxOutspends(
  txid: string,
  options: RequestParams = {},
): Promise<EsploraOutspend[]> {
  return requestJson(buildEsploraUrl(`/tx/${txid}/outspends`), outspendsListSchema, {
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
    body: trimmedHex,
    signal: options.signal,
  })
}

export async function getLatestBlockHash(options: RequestParams = {}): Promise<string> {
  return requestText(buildEsploraUrl('/blocks/tip/hash'), { signal: options.signal })
}

const blockHeightSchema = z
  .string()
  .regex(/^\d+$/, 'block height must be a positive integer string')
  .transform(value => Number.parseInt(value, 10))

export async function getLatestBlockHeight(options: RequestParams = {}): Promise<number> {
  return requestText(buildEsploraUrl('/blocks/tip/height'), blockHeightSchema, {
    signal: options.signal,
  })
}

export async function getBlockHashAtHeight(
  blockHeight: number,
  options: RequestParams = {},
): Promise<string> {
  return requestText(buildEsploraUrl(`/block-height/${blockHeight}`), { signal: options.signal })
}

export async function getBlockTxids(
  blockHash: string,
  options: RequestParams = {},
): Promise<string[]> {
  return requestJson(buildEsploraUrl(`/block/${blockHash}/txids`), txidListSchema, {
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
): Promise<ScripthashUtxoEntry[]> {
  const url = buildEsploraUrl(`${buildResourcePath(kind, identifier)}/utxo`)
  return requestJson(url, utxoListSchema, { signal: options.signal })
}

async function fetchResourceTxs(
  kind: Resource,
  identifier: string,
  lastSeenTxid: string | undefined,
  options: RequestParams,
): Promise<ScripthashTxEntry[]> {
  const basePath = buildResourcePath(kind, identifier)
  const url = buildEsploraUrl(buildTxsHistoryPath(basePath, lastSeenTxid))
  return requestJson(url, txListSchema, { signal: options.signal })
}

export async function getAddressInfo(
  address: string,
  options: RequestParams = {},
): Promise<AddressInfo> {
  return fetchResourceInfo('address', address, options)
}

export async function getAddressUtxo(
  address: string,
  options: RequestParams = {},
): Promise<ScripthashUtxoEntry[]> {
  return fetchResourceUtxos('address', address, options)
}

export async function getAddressTxs(
  address: string,
  lastSeenTxid?: string,
  options: RequestParams = {},
): Promise<ScripthashTxEntry[]> {
  return fetchResourceTxs('address', address, lastSeenTxid, options)
}

export async function getScripthashInfo(
  scripthash: string,
  options: RequestParams = {},
): Promise<AddressInfo> {
  return fetchResourceInfo('scripthash', scripthash, options)
}

export async function getScripthashUtxo(
  scripthash: string,
  options: RequestParams = {},
): Promise<ScripthashUtxoEntry[]> {
  return fetchResourceUtxos('scripthash', scripthash, options)
}

export async function getScripthashTxs(
  scripthash: string,
  lastSeenTxid?: string,
  options: RequestParams = {},
): Promise<ScripthashTxEntry[]> {
  return fetchResourceTxs('scripthash', scripthash, lastSeenTxid, options)
}

export async function hashScriptPubkeyHex(scriptPubkeyHex: string): Promise<Uint8Array> {
  const scriptBytes = hexToBytes(scriptPubkeyHex)
  const digestBuffer = await crypto.subtle.digest('SHA-256', scriptBytes)
  return new Uint8Array(digestBuffer)
}

export async function scriptPubkeyToScripthash(scriptPubkeyHex: string): Promise<string> {
  const hashBytes = await hashScriptPubkeyHex(scriptPubkeyHex)
  hashBytes.reverse()
  return bytesToHex(hashBytes)
}
