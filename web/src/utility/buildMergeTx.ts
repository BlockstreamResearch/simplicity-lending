/**
 * Build and sign a merge tx: multiple inputs (same key), one or more outputs, fee.
 * Signs each P2PK input via signP2pkInputs.
 */

import { getLwk } from '../simplicity'
import type { P2pkNetwork } from '../simplicity'
import type { EsploraVout } from '../api/esplora'
import { createPsetBuilder } from '../tx/psetBuilder'
import type { PsetWithExtractTx } from '../simplicity'
import { signP2pkInputs } from './signP2pkInputs'

export interface MergeTxInput {
  outpoint: { txid: string; vout: number }
  prevout: EsploraVout
}

export interface MergeTxOutput {
  address: string
  amount: bigint
  assetId?: string
}

export interface BuildMergeTxParams {
  inputs: MergeTxInput[]
  outputs: MergeTxOutput[]
  feeAmount: bigint
  secretKey: Uint8Array
  network: P2pkNetwork
}

/**
 * Build PSET with N inputs, M outputs, fee. Sign each input in order; return signed tx hex.
 */
export async function buildAndSignMergeTx(params: BuildMergeTxParams): Promise<string> {
  const network: 'mainnet' | 'testnet' = params.network === 'mainnet' ? 'mainnet' : 'testnet'
  const api = await createPsetBuilder(network)

  for (const inp of params.inputs) {
    api.addInput(inp.outpoint, inp.prevout)
  }
  for (const o of params.outputs) {
    api.addOutputToAddress(o.address, o.amount, o.assetId)
  }
  api.addFeeOutput(params.feeAmount)

  const { pset } = api.build()

  const lwk = await getLwk()
  return signP2pkInputs({
    lwk,
    network,
    pset: pset as PsetWithExtractTx,
    secretKey: params.secretKey,
    prevouts: params.inputs.map((inp) => inp.prevout),
  })
}
