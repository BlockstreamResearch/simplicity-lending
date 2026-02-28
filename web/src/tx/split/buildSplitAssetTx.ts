/**
 * Build and sign a split-asset tx: two inputs (fee in LBTC + asset to split),
 * outputs in asset + two change outputs (LBTC and asset) + fee.
 * Signs both P2PK inputs via signP2pkInputs.
 */

import { getLwk } from '../../simplicity'
import type { P2pkNetwork } from '../../simplicity'
import type { EsploraVout } from '../../api/esplora'
import { createPsetBuilder } from '../psetBuilder'
import type { PsetWithExtractTx } from '../../simplicity'
import { signP2pkInputs } from '../../utility/signP2pkInputs'

export interface BuildSplitAssetTxParams {
  /** Fee input: LBTC UTXO (outpoint + prevout). */
  feeInput: { outpoint: { txid: string; vout: number }; prevout: EsploraVout }
  /** Asset input: custom asset UTXO to split. */
  assetInput: { outpoint: { txid: string; vout: number }; prevout: EsploraVout }
  /** Recipient outputs in the same asset as assetInput. */
  outputs: { address: string; amount: bigint }[]
  /** Change in asset (to user). Use when assetInput.value - sum(outputs) > 0. */
  changeAsset: { address: string; amount: bigint } | null
  /** Change in LBTC (to user). Use when feeInput.value - feeAmount > 0. */
  changeLbtc: { address: string; amount: bigint } | null
  /** Fee amount in sats (LBTC). */
  feeAmount: bigint
  network: P2pkNetwork
}

export interface BuildSplitAssetTxResult {
  pset: unknown
  unsignedTxHex: string
  prevouts: EsploraVout[]
}

export interface FinalizeSplitAssetTxParams {
  pset: PsetWithExtractTx
  prevouts: EsploraVout[]
  secretKey: Uint8Array
  network: P2pkNetwork
}

/**
 * Build split-asset PSET (no signing). Returns pset, unsignedTxHex, prevouts for finalize.
 */
export async function buildSplitAssetTx(
  params: BuildSplitAssetTxParams
): Promise<BuildSplitAssetTxResult> {
  const network: 'mainnet' | 'testnet' = params.network === 'mainnet' ? 'mainnet' : 'testnet'
  const api = await createPsetBuilder(network)

  api.addInput(params.feeInput.outpoint, params.feeInput.prevout)
  api.addInput(params.assetInput.outpoint, params.assetInput.prevout)

  const assetId = params.assetInput.prevout.asset
  if (!assetId) throw new Error('Asset input must have asset id')

  for (const o of params.outputs) {
    api.addOutputToAddress(o.address, o.amount, assetId)
  }
  if (params.changeAsset && params.changeAsset.amount > 0n) {
    api.addOutputToAddress(params.changeAsset.address, params.changeAsset.amount, assetId)
  }
  if (params.changeLbtc && params.changeLbtc.amount > 0n) {
    api.addOutputToAddress(params.changeLbtc.address, params.changeLbtc.amount)
  }
  api.addFeeOutput(params.feeAmount)

  const { pset } = api.build()
  const prevouts = [params.feeInput.prevout, params.assetInput.prevout]
  const unsignedTxHex = (pset as PsetWithExtractTx).extractTx().toString()
  return { pset, unsignedTxHex, prevouts }
}

/**
 * Finalize (sign) split-asset PSET and return signed tx hex.
 */
export async function finalizeSplitAssetTx(params: FinalizeSplitAssetTxParams): Promise<string> {
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

export interface BuildAndSignSplitAssetTxParams extends BuildSplitAssetTxParams {
  secretKey: Uint8Array
}

/**
 * Build PSET with two inputs (fee then asset), asset outputs, changes, fee.
 * Sign input 0 then input 1; return signed tx hex.
 */
export async function buildAndSignSplitAssetTx(
  params: BuildAndSignSplitAssetTxParams
): Promise<string> {
  const built = await buildSplitAssetTx(params)
  return finalizeSplitAssetTx({
    pset: built.pset as PsetWithExtractTx,
    prevouts: built.prevouts,
    secretKey: params.secretKey,
    network: params.network,
  })
}
