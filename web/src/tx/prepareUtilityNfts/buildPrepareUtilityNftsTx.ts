/**
 * Build and sign the "Prepare 4 UTXOs" transaction for Utility NFTs issuance.
 * One LBTC input with issuance → 4 outputs of the new asset (10 each) + change + fee.
 */

import type { P2pkNetwork } from '../../simplicity'
import type { EsploraVout } from '../../api/esplora'
import { createPsetBuilder } from '../psetBuilder'
import type { PsetWithExtractTx } from '../../simplicity'
import { signP2pkInputs } from '../../utility/signP2pkInputs'

const ISSUANCE_UTXOS_COUNT = 4
const ISSUANCE_UTXO_VALUE = 10
const ISSUANCE_TOTAL_AMOUNT = BigInt(ISSUANCE_UTXOS_COUNT * ISSUANCE_UTXO_VALUE) // 400

export interface BuildPrepareUtilityNftsTxParams {
  feeUtxo: { outpoint: { txid: string; vout: number }; prevout: EsploraVout }
  toAddress: string
  feeAmount: bigint
  network: P2pkNetwork
}

export interface BuildPrepareUtilityNftsTxResult {
  pset: unknown
  unsignedTxHex: string
  prevouts: EsploraVout[]
  auxiliaryAssetId: string
  /** 32-byte issuance entropy as 64-char hex; save for Step 2 (Issue Utility NFTs). */
  issuanceEntropyHex: string
}

export interface FinalizePrepareUtilityNftsTxParams {
  pset: PsetWithExtractTx
  prevouts: EsploraVout[]
  secretKey: Uint8Array
  network: P2pkNetwork
}

/**
 * Build Prepare Utility NFTs PSET (no signing). Returns pset, unsignedTxHex, prevouts, auxiliaryAssetId, issuanceEntropyHex.
 */
export async function buildPrepareUtilityNftsTx(
  params: BuildPrepareUtilityNftsTxParams
): Promise<BuildPrepareUtilityNftsTxResult> {
  const { feeUtxo, toAddress, feeAmount, network } = params
  const networkKey = network === 'mainnet' ? 'mainnet' : 'testnet'
  const prevoutValue = BigInt(feeUtxo.prevout.value ?? 0)
  if (prevoutValue < feeAmount) {
    throw new Error(`Fee UTXO value ${prevoutValue} is less than fee ${feeAmount}`)
  }

  const changeAmount = prevoutValue - feeAmount

  const issuanceEntropyBytes = crypto.getRandomValues(new Uint8Array(32))

  const api = await createPsetBuilder(networkKey)
  const auxiliaryAssetId = api.addInputWithIssuance(
    feeUtxo.outpoint,
    feeUtxo.prevout,
    ISSUANCE_TOTAL_AMOUNT,
    issuanceEntropyBytes
  )

  for (let i = 0; i < ISSUANCE_UTXOS_COUNT; i++) {
    api.addOutputToAddress(toAddress, BigInt(ISSUANCE_UTXO_VALUE), auxiliaryAssetId)
  }
  if (changeAmount > 0n) {
    api.addOutputToAddress(toAddress, changeAmount, api.getPolicyAssetHex())
  }
  api.addFeeOutput(feeAmount)
  const { pset } = api.build()

  const prevouts = [feeUtxo.prevout]
  const unsignedTxHex = (pset as PsetWithExtractTx).extractTx().toString()
  const issuanceEntropyHex = Array.from(issuanceEntropyBytes)
    .map((b) => (b & 0xff).toString(16).padStart(2, '0'))
    .join('')
  return { pset, unsignedTxHex, prevouts, auxiliaryAssetId, issuanceEntropyHex }
}

/**
 * Finalize (sign) Prepare Utility NFTs PSET and return signed tx hex.
 */
export async function finalizePrepareUtilityNftsTx(
  params: FinalizePrepareUtilityNftsTxParams
): Promise<string> {
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

export interface BuildAndSignPrepareUtilityNftsTxParams extends BuildPrepareUtilityNftsTxParams {
  secretKey: Uint8Array
}

export interface BuildAndSignPrepareUtilityNftsTxResult {
  signedTxHex: string
  auxiliaryAssetId: string
  issuanceEntropyHex: string
}

/**
 * Build and sign the preparation tx; returns signed tx hex and the new asset id.
 */
export async function buildAndSignPrepareUtilityNftsTx(
  params: BuildAndSignPrepareUtilityNftsTxParams
): Promise<BuildAndSignPrepareUtilityNftsTxResult> {
  const built = await buildPrepareUtilityNftsTx(params)
  const signedTxHex = await finalizePrepareUtilityNftsTx({
    pset: built.pset as PsetWithExtractTx,
    prevouts: built.prevouts,
    secretKey: params.secretKey,
    network: params.network,
  })
  return {
    signedTxHex,
    auxiliaryAssetId: built.auxiliaryAssetId,
    issuanceEntropyHex: built.issuanceEntropyHex,
  }
}
