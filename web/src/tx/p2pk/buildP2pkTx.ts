/**
 * Build and sign a single-input P2PK (Simplicity) transaction that spends one UTXO
 * to multiple outputs (native asset only) plus a fee output.
 * Uses tx/psetBuilder wrapper for PSET construction, then signP2pkInputs for signing.
 */

import { getLwk } from '../../simplicity'
import type { P2pkNetwork } from '../../simplicity'
import type { EsploraVout } from '../../api/esplora'
import { createPsetBuilder } from '../psetBuilder'
import type { PsetWithExtractTx } from '../../simplicity'
import { signP2pkInputs } from '../../utility/signP2pkInputs'

export interface BuildP2pkTxParams {
  /** OutPoint to spend (txid + vout index). */
  outpoint: { txid: string; vout: number }
  /** Previous output as returned by Esplora (scriptpubkey hex, value, asset). */
  prevout: EsploraVout
  /** Recipient outputs: address + amount in sats (native asset only). */
  outputs: { address: string; amount: bigint }[]
  /** Change output (back to user). Omit if amount is 0. */
  change: { address: string; amount: bigint } | null
  /** Fee amount in sats (native asset). Last output with empty script. */
  feeAmount: bigint
  network: P2pkNetwork
}

export interface BuildP2pkTxResult {
  pset: unknown
  unsignedTxHex: string
  prevouts: EsploraVout[]
}

export interface FinalizeP2pkTxParams {
  pset: PsetWithExtractTx
  prevouts: EsploraVout[]
  secretKey: Uint8Array
  network: P2pkNetwork
}

/**
 * Build unsigned P2PK PSET. Returns pset, unsignedTxHex, and prevouts for finalize.
 */
export async function buildP2pkTx(params: BuildP2pkTxParams): Promise<BuildP2pkTxResult> {
  const network: 'mainnet' | 'testnet' = params.network === 'mainnet' ? 'mainnet' : 'testnet'
  const api = await createPsetBuilder(network)
  api.addInput(params.outpoint, params.prevout)
  for (const o of params.outputs) {
    api.addOutputToAddress(o.address, o.amount)
  }
  if (params.change && params.change.amount > 0n) {
    api.addOutputToAddress(params.change.address, params.change.amount)
  }
  api.addFeeOutput(params.feeAmount)
  const { pset } = api.build()
  const prevouts = [params.prevout]
  const unsignedTxHex = (pset as PsetWithExtractTx).extractTx().toString()
  return { pset, unsignedTxHex, prevouts }
}

/**
 * Finalize (sign) a P2PK PSET and return signed tx hex.
 */
export async function finalizeP2pkTx(params: FinalizeP2pkTxParams): Promise<string> {
  const network: 'mainnet' | 'testnet' = params.network === 'mainnet' ? 'mainnet' : 'testnet'
  const lwk = await getLwk()
  return signP2pkInputs({
    lwk,
    network,
    pset: params.pset,
    secretKey: params.secretKey,
    prevouts: params.prevouts,
  })
}

export interface BuildAndSignP2pkTxParams extends BuildP2pkTxParams {
  secretKey: Uint8Array
}

/**
 * Build unsigned PSET via wrapper, sign the single P2PK input, and return the signed transaction hex.
 */
export async function buildAndSignP2pkTx(params: BuildAndSignP2pkTxParams): Promise<string> {
  const built = await buildP2pkTx(params)
  return finalizeP2pkTx({
    pset: built.pset as PsetWithExtractTx,
    prevouts: built.prevouts,
    secretKey: params.secretKey,
    network: params.network,
  })
}
