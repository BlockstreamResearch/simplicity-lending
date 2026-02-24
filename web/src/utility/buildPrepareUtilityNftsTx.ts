/**
 * Build and sign the "Prepare 4 UTXOs" transaction for Utility NFTs issuance.
 * One fee UTXO (LBTC) → 4 outputs of 100 sats each to toAddress + change + fee.
 * Matches crates/contracts/src/sdk/pre_lock/utility_nfts_issuance_preparation.rs.
 */

import type { P2pkNetwork } from '../utility/addressP2pk'
import type { EsploraVout } from '../api/esplora'
import { createPsetBuilder } from '../tx/psetBuilder'
import type { PsetWithExtractTx } from '../simplicity'
import { signP2pkInputs } from './signP2pkInputs'

const ISSUANCE_UTXOS_COUNT = 4
const ISSUANCE_UTXO_VALUE = 100

export interface BuildPrepareUtilityNftsTxParams {
  feeUtxo: { outpoint: { txid: string; vout: number }; prevout: EsploraVout }
  toAddress: string
  feeAmount: bigint
  secretKey: Uint8Array
  network: P2pkNetwork
}

/**
 * Build and sign the preparation tx; returns signed tx hex.
 */
export async function buildAndSignPrepareUtilityNftsTx(
  params: BuildPrepareUtilityNftsTxParams
): Promise<string> {
  const { feeUtxo, toAddress, feeAmount, secretKey, network } = params
  const networkKey = network === 'mainnet' ? 'mainnet' : 'testnet'
  const totalRequired = feeAmount + BigInt(ISSUANCE_UTXOS_COUNT * ISSUANCE_UTXO_VALUE)
  const prevoutValue = BigInt(feeUtxo.prevout.value ?? 0)
  if (prevoutValue < totalRequired) {
    throw new Error(
      `Fee UTXO value ${prevoutValue} is less than required ${totalRequired} (fee + ${ISSUANCE_UTXOS_COUNT * ISSUANCE_UTXO_VALUE} sats for 4 issuance outputs)`
    )
  }

  const changeAmount = prevoutValue - totalRequired

  const api = await createPsetBuilder(networkKey)
  api.addInput(feeUtxo.outpoint, feeUtxo.prevout)
  for (let i = 0; i < ISSUANCE_UTXOS_COUNT; i++) {
    api.addOutputToAddress(toAddress, BigInt(ISSUANCE_UTXO_VALUE))
  }
  if (changeAmount > 0n) {
    api.addOutputToAddress(toAddress, changeAmount)
  }
  api.addFeeOutput(feeAmount)
  const { pset } = api.build()

  const { getLwk } = await import('../simplicity')
  const lwk = await getLwk()
  return signP2pkInputs({
    lwk,
    network: networkKey,
    pset: pset as PsetWithExtractTx,
    secretKey,
    prevouts: [feeUtxo.prevout],
  })
}
