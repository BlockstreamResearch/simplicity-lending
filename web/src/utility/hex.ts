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
 * Parse OP_RETURN with 64-byte push (6a40 + 64 bytes hex = 128 chars).
 * Returns borrower_pubkey (32 bytes) and principal_asset_id (32 bytes) from offer creation tx.
 */
export function parseOpReturn64(scriptHex: string): {
  borrowerPubKey: Uint8Array
  principalAssetId: Uint8Array
} {
  const hex = normalizeHex(scriptHex).replace(/\s/g, '')
  if (!hex.startsWith('6a40')) {
    throw new Error('Offer creation OP_RETURN must start with 6a40 (OP_RETURN + push 64)')
  }
  const dataHex = hex.slice(4)
  if (dataHex.length !== 128)
    throw new Error('Offer creation OP_RETURN must contain exactly 64 bytes')
  const data = hexToBytes32(dataHex.slice(0, 64))
  const principal = hexToBytes32(dataHex.slice(64))
  return { borrowerPubKey: data, principalAssetId: principal }
}
