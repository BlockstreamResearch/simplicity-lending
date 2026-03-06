/**
 * Build and sign a burn tx: selected ASSET UTXOs as inputs, each goes to OP_RETURN("burn") output.
 * One LBTC fee UTXO for fee (and optional change). Mirrors burn logic in cancellation.rs.
 */

import type { P2pkNetwork } from '../../simplicity'
import type { EsploraVout } from '../../api/esplora'
import { createPsetBuilder } from '../psetBuilder'
import type { PsetWithExtractTx } from '../../simplicity'
import { signP2pkInputs } from '../../utility/signP2pkInputs'
import { getScriptHexFromVout } from '../../utility/hex'
import { OP_RETURN_BURN_SCRIPT_HEX } from '../../utility/esploraPrevout'

export interface BurnTxAssetInput {
  outpoint: { txid: string; vout: number }
  prevout: EsploraVout
}

export interface BuildBurnTxParams {
  /** ASSET UTXOs to burn (each becomes input + one burn output). */
  assetInputs: BurnTxAssetInput[]
  /** LBTC UTXO for fee (and change). */
  feeUtxo: { outpoint: { txid: string; vout: number }; prevout: EsploraVout }
  feeAmount: bigint
  network: P2pkNetwork
}

export interface BuildBurnTxResult {
  pset: unknown
  unsignedTxHex: string
  prevouts: EsploraVout[]
}

export interface FinalizeBurnTxParams {
  pset: PsetWithExtractTx
  prevouts: EsploraVout[]
  secretKey: Uint8Array
  network: P2pkNetwork
}

/**
 * Build burn PSET (no signing). Returns pset, unsignedTxHex, prevouts for finalize.
 */
export async function buildBurnTx(params: BuildBurnTxParams): Promise<BuildBurnTxResult> {
  const { assetInputs, feeUtxo, feeAmount, network } = params

  const feeValue = BigInt(feeUtxo.prevout.value ?? 0)
  if (feeValue < feeAmount) {
    throw new Error(`Fee UTXO value ${feeValue} is less than fee ${feeAmount}`)
  }
  const changeAmount = feeValue - feeAmount

  const networkKey = network === 'mainnet' ? 'mainnet' : 'testnet'
  const api = await createPsetBuilder(networkKey)
  const policyAssetHex = api.getPolicyAssetHex()

  for (const inp of assetInputs) {
    api.addInput(inp.outpoint, inp.prevout)
    const value = BigInt(inp.prevout.value ?? 0)
    const assetHex = inp.prevout.asset ?? policyAssetHex
    api.addOutputWithScript(OP_RETURN_BURN_SCRIPT_HEX, value, assetHex)
  }

  api.addInput(feeUtxo.outpoint, feeUtxo.prevout)
  if (changeAmount > 0n) {
    const changeScriptHex = getScriptHexFromVout(feeUtxo.prevout)
    api.addOutputWithScript(changeScriptHex, changeAmount, policyAssetHex)
  }
  api.addFeeOutput(feeAmount)

  const { pset } = api.build()
  const prevouts: EsploraVout[] = [...assetInputs.map((i) => i.prevout), feeUtxo.prevout]
  const unsignedTxHex = (pset as PsetWithExtractTx).extractTx().toString()
  return { pset, unsignedTxHex, prevouts }
}

/**
 * Finalize (sign) burn PSET and return signed tx hex.
 */
export async function finalizeBurnTx(params: FinalizeBurnTxParams): Promise<string> {
  const networkKey = params.network === 'mainnet' ? 'mainnet' : 'testnet'
  const { getLwk } = await import('../../simplicity')
  const lwk = await getLwk()
  return signP2pkInputs({
    lwk,
    network: networkKey,
    pset: params.pset,
    secretKey: params.secretKey,
    prevouts: params.prevouts,
  })
}

export interface BuildAndSignBurnTxParams extends BuildBurnTxParams {
  secretKey: Uint8Array
}

/**
 * Build PSET: for each asset input add input + burn output; add fee input, optional change, fee output. Sign and return signed tx hex.
 */
export async function buildAndSignBurnTx(params: BuildAndSignBurnTxParams): Promise<string> {
  const built = await buildBurnTx(params)
  return finalizeBurnTx({
    pset: built.pset as PsetWithExtractTx,
    prevouts: built.prevouts,
    secretKey: params.secretKey,
    network: params.network,
  })
}
