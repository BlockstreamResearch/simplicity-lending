/**
 * Helpers for building transactions from Esplora prevouts/tx.
 * Shared by build*Tx modules to avoid duplicating requireVout, requireAssetHex, requireValue.
 */

import type { EsploraTx, EsploraVout } from '../api/esplora'
import { normalizeHex } from './hex'

/** OP_RETURN "burn" script (6a 04 6275726e). Used by burn, liquidation, repayment, assetAuthUnlock. */
export const OP_RETURN_BURN_SCRIPT_HEX = '6a046275726e'

export function requireVout(
  tx: EsploraTx,
  vout: number,
  label: string,
  context: string = 'transaction'
): EsploraVout {
  const out = tx.vout?.[vout]
  if (!out) throw new Error(`${label} vout ${vout} missing in ${context}`)
  return out
}

export function requireAssetHex(vout: EsploraVout, label: string): string {
  const hex = normalizeHex(vout.asset ?? '')
  if (!hex || hex.length !== 64)
    throw new Error(`${label} must have explicit 32-byte asset (64 hex)`)
  return hex
}

export function requireValue(vout: EsploraVout, label: string): bigint {
  const n = vout.value
  if (typeof n !== 'number' || n < 0) throw new Error(`${label} prevout must have explicit value`)
  return BigInt(n)
}

/** Normalize asset/hex for comparison (trim, lowerCase, strip 0x). Alias for normalizeHex from hex.ts. */
export function normalizeAssetHex(hex: string): string {
  return normalizeHex(hex)
}
