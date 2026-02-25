/**
 * Build and sign the "Prepare 4 UTXOs" transaction for Utility NFTs issuance.
 * One LBTC input with issuance → 4 outputs of the new asset (10 each) + change + fee.
 */

import type { P2pkNetwork } from '../utility/addressP2pk'
import type { EsploraVout } from '../api/esplora'
import { createPsetBuilder } from '../tx/psetBuilder'
import type { PsetWithExtractTx } from '../simplicity'
import { signP2pkInputs } from './signP2pkInputs'

const ISSUANCE_UTXOS_COUNT = 4
const ISSUANCE_UTXO_VALUE = 10
const ISSUANCE_TOTAL_AMOUNT = BigInt(ISSUANCE_UTXOS_COUNT * ISSUANCE_UTXO_VALUE) // 400

export interface BuildPrepareUtilityNftsTxParams {
  feeUtxo: { outpoint: { txid: string; vout: number }; prevout: EsploraVout }
  toAddress: string
  feeAmount: bigint
  secretKey: Uint8Array
  network: P2pkNetwork
}

export interface BuildPrepareUtilityNftsTxResult {
  signedTxHex: string
  auxiliaryAssetId: string
  /** 32-byte issuance entropy as 64-char hex; save for Step 2 (Issue Utility NFTs). */
  issuanceEntropyHex: string
}

/**
 * Build and sign the preparation tx; returns signed tx hex and the new asset id.
 */
export async function buildAndSignPrepareUtilityNftsTx(
  params: BuildPrepareUtilityNftsTxParams
): Promise<BuildPrepareUtilityNftsTxResult> {
  const { feeUtxo, toAddress, feeAmount, secretKey, network } = params
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

  const { getLwk } = await import('../simplicity')
  const lwk = await getLwk()
  const signedTxHex = await signP2pkInputs({
    lwk,
    network: networkKey,
    pset: pset as PsetWithExtractTx,
    secretKey,
    prevouts: [feeUtxo.prevout],
  })
  const issuanceEntropyHex = Array.from(issuanceEntropyBytes)
    .map((b) => (b & 0xff).toString(16).padStart(2, '0'))
    .join('')
  return { signedTxHex, auxiliaryAssetId, issuanceEntropyHex }
}
