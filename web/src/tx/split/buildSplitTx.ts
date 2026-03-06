/**
 * Build and sign a split (one-in, many-out + change + fee) P2PK transaction.
 * Thin wrapper over buildAndSignP2pkTx.
 */

import { buildAndSignP2pkTx } from '../p2pk/buildP2pkTx'
import type { P2pkNetwork } from '../../simplicity'
import type { EsploraVout } from '../../api/esplora'
import type { Outpoint } from './types'

export interface BuildSplitTxParams {
  outpoint: Outpoint
  prevout: EsploraVout
  outputs: { address: string; amount: bigint }[]
  change: { address: string; amount: bigint } | null
  feeAmount: bigint
  secretKey: Uint8Array
  network: P2pkNetwork
}

/**
 * Returns signed transaction hex. Throws on build/sign failure.
 */
export async function buildSplitTx(params: BuildSplitTxParams): Promise<string> {
  return buildAndSignP2pkTx({
    outpoint: params.outpoint,
    prevout: params.prevout,
    outputs: params.outputs,
    change: params.change,
    feeAmount: params.feeAmount,
    secretKey: params.secretKey,
    network: params.network,
  })
}
