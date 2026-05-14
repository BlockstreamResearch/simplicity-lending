import { env } from '@/constants/env'
import { bytesToHex, hexToBytes } from '@/utils/hex'

function buildExplorerUrl(path: string): string {
  return `${env.VITE_ESPLORA_BASE_URL}${path}`
}

export function getTxExplorerUrl(txId: string): string {
  return buildExplorerUrl(`/tx/${txId.trim()}`)
}

export function getAssetExplorerUrl(assetId: string): string {
  return buildExplorerUrl(`/asset/${assetId.trim()}`)
}

export function getAddressExplorerUrl(address: string): string {
  return buildExplorerUrl(`/address/${address.trim()}`)
}

export async function hashScriptPubkeyHex(scriptPubkeyHex: string): Promise<Uint8Array> {
  const scriptBytes = hexToBytes(scriptPubkeyHex)
  const digestBuffer = await crypto.subtle.digest('SHA-256', scriptBytes)
  return new Uint8Array(digestBuffer)
}

export async function scriptPubkeyToScriptHash(scriptPubkeyHex: string): Promise<string> {
  const hashBytes = await hashScriptPubkeyHex(scriptPubkeyHex)
  hashBytes.reverse()
  return bytesToHex(hashBytes)
}
