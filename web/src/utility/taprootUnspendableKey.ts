/**
 * BIP-341 unspendable internal key for covenant Taproot addresses.
 * Matches crates/contracts/src/sdk/basic/taproot.rs taproot_unspendable_internal_key().
 */

import type { Lwk, LwkXOnlyPublicKey } from '../simplicity'

/** 32-byte unspendable internal key (BIP-341). */
export const TAPROOT_UNSPENDABLE_INTERNAL_KEY_BYTES = new Uint8Array([
  0x50, 0x92, 0x9b, 0x74, 0xc1, 0xa0, 0x49, 0x54, 0xb7, 0x8b, 0x4b, 0x60, 0x35, 0xe9, 0x7a, 0x5e,
  0x07, 0x8a, 0x5a, 0x0f, 0x28, 0xec, 0x96, 0xd5, 0x47, 0xbf, 0xee, 0x9a, 0xce, 0x80, 0x3a, 0xc0,
])

/**
 * Returns LWK XOnlyPublicKey for the taproot unspendable internal key.
 * Used as internal key for AssetAuth, Lending, ScriptAuth, PreLock covenant addresses.
 */
export function getTaprootUnspendableInternalKey(lwk: Lwk): LwkXOnlyPublicKey {
  return lwk.XOnlyPublicKey.fromBytes(TAPROOT_UNSPENDABLE_INTERNAL_KEY_BYTES)
}
