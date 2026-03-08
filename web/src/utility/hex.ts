/**
 * Shared hex/bytes conversion and script helpers.
 */

import type { EsploraVout } from '../api/esplora'

/** Bytes to lowercase hex string. */
export function bytesToHex(bytes: Uint8Array | Iterable<number>): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(Array.from(bytes))
  return Array.from(arr)
    .map((b) => (Number(b) & 0xff).toString(16).padStart(2, '0'))
    .join('')
}

/** Normalize hex: trim, toLowerCase, remove leading 0x. */
export function normalizeHex(hex: string): string {
  return hex.trim().toLowerCase().replace(/^0x/, '')
}

/** Parse hex string to bytes (any length). Uses normalizeHex. */
export function hexToBytes(hex: string): Uint8Array {
  const s = normalizeHex(hex).replace(/\s/g, '')
  if (s.length % 2 !== 0) throw new Error('Hex must have even length')
  const bytes = new Uint8Array(s.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

/** 64-char hex string to 32-byte array (big-endian). */
export function hexToBytes32(hex: string): Uint8Array {
  const s = normalizeHex(hex)
  if (s.length !== 64) throw new Error('Expected 64 hex chars for 32-byte value')
  return hexToBytes(s)
}

/**
 * Esplora/API use display (reversed) byte order for asset IDs; Rust/simplicityhl use internal order.
 * Converts 64-char hex from display to internal by reversing the 32 bytes. Use for asset IDs from vout.asset.
 */
export function assetIdDisplayToInternal(displayHex: string): Uint8Array {
  const bytes = hexToBytes32(displayHex)
  const out = new Uint8Array(32)
  for (let i = 0; i < 32; i++) out[i] = bytes[31 - i]!
  return out
}

/** 32 bytes to 64-char lowercase hex. */
export function bytes32ToHex(b: Uint8Array): string {
  if (b.length !== 32) throw new Error('Expected 32 bytes')
  return bytesToHex(b)
}

export interface OfferMetadata {
  borrowerPubKey: Uint8Array
  principalAssetId: Uint8Array
  borrowerOutputScriptHash?: Uint8Array
  borrowerOutputScriptPubkeyHex?: string
}

function encodeOpReturnPushPrefix(payloadLength: number): string {
  if (payloadLength <= 0x4b) return `6a${payloadLength.toString(16).padStart(2, '0')}`
  if (payloadLength <= 0xff) return `6a4c${payloadLength.toString(16).padStart(2, '0')}`
  throw new Error('Offer metadata payload is too large')
}

export function buildOfferMetadataScript(
  signingXOnlyPubkey: string,
  principalAssetId: string
): string {
  const pubkeyBytes = hexToBytes32(signingXOnlyPubkey)
  const principalInternal = assetIdDisplayToInternal(principalAssetId)
  const data = new Uint8Array(64)
  data.set(pubkeyBytes, 0)
  data.set(principalInternal, 32)
  return `${encodeOpReturnPushPrefix(data.length)}${bytesToHex(data)}`
}

export function buildBorrowerOutputScriptMetadataScript(
  borrowerOutputScriptPubkeyHex: string
): string {
  const normalizedScript = normalizeHex(borrowerOutputScriptPubkeyHex)
  if (normalizedScript.length === 0 || normalizedScript.length % 2 !== 0) {
    throw new Error('Borrower output script metadata must contain a script_pubkey hex payload')
  }
  const borrowerOutputScript = hexToBytes(normalizedScript)
  return `${encodeOpReturnPushPrefix(borrowerOutputScript.length)}${bytesToHex(
    borrowerOutputScript
  )}`
}

function parseOpReturnPayload(scriptHex: string): Uint8Array {
  const hex = normalizeHex(scriptHex).replace(/\s/g, '')
  if (!hex.startsWith('6a')) {
    throw new Error('Offer metadata output must start with OP_RETURN')
  }

  let length = 0
  let payloadOffset = 0

  if (hex.startsWith('6a4c')) {
    length = parseInt(hex.slice(4, 6), 16)
    payloadOffset = 6
  } else {
    length = parseInt(hex.slice(2, 4), 16)
    payloadOffset = 4
  }

  const dataHex = hex.slice(payloadOffset)
  if (dataHex.length !== length * 2) {
    throw new Error('Offer metadata output does not match its declared payload length')
  }

  return hexToBytes(dataHex)
}

/**
 * Get script_pubkey hex from an Esplora vout.
 * Uses scriptpubkey_hex or scriptpubkey (string or .hex).
 */
export function getScriptHexFromVout(vout: EsploraVout): string {
  const sp = vout.scriptpubkey
  const hex =
    vout.scriptpubkey_hex ??
    (typeof sp === 'string'
      ? sp
      : sp && typeof sp === 'object' && 'hex' in sp
        ? (sp as { hex: string }).hex
        : undefined)
  if (!hex || typeof hex !== 'string') throw new Error('Missing scriptpubkey hex in vout')
  return hex
}

/**
 * Parse the primary 64-byte offer creation metadata output. An optional second
 * 32-byte OP_RETURN can carry the borrower output script hash.
 */
export function parseOfferMetadataOutputs(
  scriptHex: string,
  borrowerOutputMetadataScriptHex?: string
): OfferMetadata {
  const data = parseOpReturnPayload(scriptHex)
  if (data.length !== 64) {
    throw new Error('Offer creation OP_RETURN must contain exactly 64 bytes')
  }

  const borrowerOutputMetadata = borrowerOutputMetadataScriptHex
    ? parseOfferBorrowerOutputScriptMetadataScript(borrowerOutputMetadataScriptHex)
    : undefined

  return {
    borrowerPubKey: data.slice(0, 32),
    principalAssetId: data.slice(32, 64),
    ...borrowerOutputMetadata,
  }
}

export function parseOfferBorrowerOutputScriptMetadataScript(
  scriptHex: string
): Pick<OfferMetadata, 'borrowerOutputScriptHash' | 'borrowerOutputScriptPubkeyHex'> {
  const payload = parseOpReturnPayload(scriptHex)

  if (payload.length === 32) {
    return { borrowerOutputScriptHash: payload }
  }

  return { borrowerOutputScriptPubkeyHex: bytesToHex(payload) }
}

export function parseOpReturn64(scriptHex: string): {
  borrowerPubKey: Uint8Array
  principalAssetId: Uint8Array
} {
  const metadata = parseOfferMetadataOutputs(scriptHex)
  return {
    borrowerPubKey: metadata.borrowerPubKey,
    principalAssetId: metadata.principalAssetId,
  }
}
