/**
 * Seed and key derivation for demo signer (no real wallet).
 * Matches logic in crates/cli/src/modules/keys.rs: SEED_HEX is 32 bytes (64 hex chars),
 * key for index i = seed with bytes 24..28 XORed with index (big-endian).
 * Seed is kept in React state only (no localStorage).
 */

/**
 * Parse SEED_HEX: must be 64 hex chars (32 bytes).
 */
export function parseSeedHex(hex: string): Uint8Array {
  const trimmed = hex.trim().toLowerCase().replace(/^0x/, '')
  if (!/^[0-9a-f]*$/.test(trimmed)) throw new Error('SEED_HEX must be hex')
  if (trimmed.length !== 64) throw new Error('SEED_HEX must be 32 bytes (64 hex chars)')
  const bytes = new Uint8Array(32)
  for (let i = 0; i < 32; i++) bytes[i] = parseInt(trimmed.slice(i * 2, i * 2 + 2), 16)
  return bytes
}

/**
 * Derive 32-byte secret key for index (same as keys.rs).
 */
export function deriveSecretKeyFromIndex(seedBytes: Uint8Array, index: number): Uint8Array {
  const out = new Uint8Array(32)
  out.set(seedBytes)
  const be = new Uint8Array(4)
  new DataView(be.buffer).setUint32(0, index, false)
  for (let i = 0; i < 4; i++) out[24 + i] ^= be[i]
  return out
}
