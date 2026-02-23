/**
 * Build a single LWK TxOut from Esplora prevout.
 * Use a fresh instance for each LWK call that takes ownership (e.g. getSighashAll and finalizeTransaction
 * must each receive their own TxOut instances — do not reuse the same array).
 */

import type { Lwk, LwkTxOut } from '../simplicity'
import type { EsploraVout } from '../api/esplora'
import type { PsetNetwork } from '../tx/psetBuilder'

function getScriptHexFromVout(vout: EsploraVout): string {
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
 * Create one LWK TxOut from prevout. Call twice when you need two separate instances for
 * getSighashAll and finalizeTransaction (LWK consumes the array each time).
 */
export function buildTxOutFromPrevout(
  lwk: Lwk,
  network: PsetNetwork,
  prevout: EsploraVout
): LwkTxOut {
  const { Script, TxOut, AssetId, Network } = lwk
  const scriptHex = getScriptHexFromVout(prevout)
  const value = prevout.value
  if (value == null || value < 0) throw new Error('Missing or invalid prevout value')
  const net = network === 'mainnet' ? Network.mainnet() : Network.testnet()
  const policyAsset = net.policyAsset()
  const assetHex = prevout.asset ?? policyAsset.toString()
  return TxOut.fromExplicit(new Script(scriptHex), new AssetId(assetHex), BigInt(value))
}
