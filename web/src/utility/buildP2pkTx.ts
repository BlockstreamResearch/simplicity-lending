/**
 * Build and sign a single-input P2PK (Simplicity) transaction that spends one UTXO
 * to multiple outputs (native asset only) plus a fee output.
 * Uses tx/psetBuilder wrapper for PSET construction, then signP2pkInputs for signing.
 */

import { getLwk } from '../simplicity'
import type { P2pkNetwork } from '../simplicity'
import type { EsploraVout } from '../api/esplora'
import { createPsetBuilder } from '../tx/psetBuilder'
import type { PsetWithExtractTx } from '../simplicity'
import { signP2pkInputs } from './signP2pkInputs'

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
  /** Secret key (32 bytes) for the P2PK input. */
  secretKey: Uint8Array
  network: P2pkNetwork
}

/**
 * Build unsigned PSET via wrapper, sign the single P2PK input, and return the signed transaction hex.
 */
export async function buildAndSignP2pkTx(params: BuildP2pkTxParams): Promise<string> {
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

  const lwk = await getLwk()
  return signP2pkInputs({
    lwk,
    network,
    pset: pset as PsetWithExtractTx,
    secretKey: params.secretKey,
    prevouts: [params.prevout],
  })
}
