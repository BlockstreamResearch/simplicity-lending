/**
 * Build and sign a merge tx: multiple inputs (same key), one or more outputs, fee.
 * Signs each P2PK input via signP2pkInputs.
 */

import { getLwk } from '../../simplicity'
import type { P2pkNetwork } from '../../simplicity'
import type { EsploraVout } from '../../api/esplora'
import { createPsetBuilder } from '../psetBuilder'
import type { PsetWithExtractTx } from '../../simplicity'
import { signP2pkInputs } from '../../utility/signP2pkInputs'

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
  network: P2pkNetwork
  /** When set (e.g. Merge Asset), this input pays the fee in LBTC; added after inputs. */
  feeInput?: MergeTxInput
}

export interface BuildMergeTxResult {
  pset: unknown
  unsignedTxHex: string
  prevouts: EsploraVout[]
}

export interface FinalizeMergeTxParams {
  pset: PsetWithExtractTx
  prevouts: EsploraVout[]
  secretKey: Uint8Array
  network: P2pkNetwork
}

/**
 * Build merge PSET (no signing). Returns pset, unsignedTxHex, prevouts for finalize.
 * If feeInput is provided, it is added as the last input and pays the fee output.
 */
export async function buildMergeTx(params: BuildMergeTxParams): Promise<BuildMergeTxResult> {
  const network: 'mainnet' | 'testnet' = params.network === 'mainnet' ? 'mainnet' : 'testnet'
  const api = await createPsetBuilder(network)

  const allInputs = params.feeInput != null ? [...params.inputs, params.feeInput] : params.inputs
  for (const inp of allInputs) {
    api.addInput(inp.outpoint, inp.prevout)
  }
  for (const o of params.outputs) {
    api.addOutputToAddress(o.address, o.amount, o.assetId)
  }
  api.addFeeOutput(params.feeAmount)

  const { pset } = api.build()
  const prevouts = allInputs.map((inp) => inp.prevout)
  const unsignedTxHex = (pset as PsetWithExtractTx).extractTx().toString()
  return { pset, unsignedTxHex, prevouts }
}

/**
 * Finalize (sign) merge PSET and return signed tx hex.
 */
export async function finalizeMergeTx(params: FinalizeMergeTxParams): Promise<string> {
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

export interface BuildAndSignMergeTxParams extends BuildMergeTxParams {
  secretKey: Uint8Array
}

/**
 * Build PSET with N inputs, M outputs, fee. Sign each input in order; return signed tx hex.
 */
export async function buildAndSignMergeTx(params: BuildAndSignMergeTxParams): Promise<string> {
  const built = await buildMergeTx(params)
  return finalizeMergeTx({
    pset: built.pset as PsetWithExtractTx,
    prevouts: built.prevouts,
    secretKey: params.secretKey,
    network: params.network,
  })
}
