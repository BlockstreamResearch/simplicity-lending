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
