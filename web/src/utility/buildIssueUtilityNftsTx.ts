/**
 * Build and sign the "Issue Utility NFTs" transaction.
 * Mirrors crates/contracts/src/sdk/pre_lock/utility_nfts_issuing.rs:
 * 4 inputs with NFT issuance (Borrower, Lender, First Params, Second Params) + 1 fee input;
 * 4 NFT outputs + 4 return outputs + optional change + fee output.
 */

import type { P2pkNetwork } from './addressP2pk'
import type { EsploraVout } from '../api/esplora'
import { createPsetBuilder } from '../tx/psetBuilder'
import type { PsetWithExtractTx } from '../simplicity'
import { signP2pkInputs } from './signP2pkInputs'

function getScriptHexFromVout(vout: EsploraVout): string {
  const sp = vout.scriptpubkey
  const hex =
    vout.scriptpubkey_hex ??
    (typeof sp === 'string'
      ? sp
      : sp && typeof sp === 'object' && 'hex' in sp
        ? (sp as { hex: string }).hex
        : undefined)
  if (!hex || typeof hex !== 'string') throw new Error('Missing scriptpubkey hex in vout')
  return hex
}

export interface IssuanceUtxo {
  outpoint: { txid: string; vout: number }
  prevout: EsploraVout
}

export interface BuildIssueUtilityNftsTxParams {
  /** 4 auxiliary UTXOs in order: first, second, third, fourth (vouts 0,1,2,3 of prepare tx). */
  issuanceUtxos: [IssuanceUtxo, IssuanceUtxo, IssuanceUtxo, IssuanceUtxo]
  feeUtxo: { outpoint: { txid: string; vout: number }; prevout: EsploraVout }
  issuanceEntropyBytes: Uint8Array
  firstParametersNftAmount: bigint
  secondParametersNftAmount: bigint
  /** Address receiving the 4 NFT outputs (Borrower, Lender, First Params, Second Params). */
  utilityNftsToAddress: string
  feeAmount: bigint
  secretKey: Uint8Array
  network: P2pkNetwork
}

export interface BuildIssueUtilityNftsTxResult {
  signedTxHex: string
}

/**
 * Build and sign the Issue Utility NFTs tx; returns signed tx hex.
 */
export async function buildAndSignIssueUtilityNftsTx(
  params: BuildIssueUtilityNftsTxParams
): Promise<BuildIssueUtilityNftsTxResult> {
  const {
    issuanceUtxos,
    feeUtxo,
    issuanceEntropyBytes,
    firstParametersNftAmount,
    secondParametersNftAmount,
    utilityNftsToAddress,
    feeAmount,
    secretKey,
    network,
  } = params

  const feeValue = BigInt(feeUtxo.prevout.value ?? 0)
  if (feeValue < feeAmount) {
    throw new Error(`Fee UTXO value ${feeValue} is less than fee ${feeAmount}`)
  }
  const changeAmount = feeValue - feeAmount

  const networkKey = network === 'mainnet' ? 'mainnet' : 'testnet'
  const api = await createPsetBuilder(networkKey)

  // Inputs: 4 with issuance (same entropy), then fee
  const borrowerAssetId = api.addInputWithIssuance(
    issuanceUtxos[0].outpoint,
    issuanceUtxos[0].prevout,
    1n,
    issuanceEntropyBytes
  )
  const lenderAssetId = api.addInputWithIssuance(
    issuanceUtxos[1].outpoint,
    issuanceUtxos[1].prevout,
    1n,
    issuanceEntropyBytes
  )
  const firstParamsAssetId = api.addInputWithIssuance(
    issuanceUtxos[2].outpoint,
    issuanceUtxos[2].prevout,
    firstParametersNftAmount,
    issuanceEntropyBytes
  )
  const secondParamsAssetId = api.addInputWithIssuance(
    issuanceUtxos[3].outpoint,
    issuanceUtxos[3].prevout,
    secondParametersNftAmount,
    issuanceEntropyBytes
  )
  api.addInput(feeUtxo.outpoint, feeUtxo.prevout)

  // Outputs: 4 NFTs, 4 return, change (if any), fee
  api.addOutputToAddress(utilityNftsToAddress, 1n, borrowerAssetId)
  api.addOutputToAddress(utilityNftsToAddress, 1n, lenderAssetId)
  api.addOutputToAddress(utilityNftsToAddress, firstParametersNftAmount, firstParamsAssetId)
  api.addOutputToAddress(utilityNftsToAddress, secondParametersNftAmount, secondParamsAssetId)

  const policyAssetHex = api.getPolicyAssetHex()
  for (let i = 0; i < 4; i++) {
    const v = issuanceUtxos[i]!.prevout
    const scriptHex = getScriptHexFromVout(v)
    const value = BigInt(v.value ?? 0)
    const asset = v.asset ?? policyAssetHex
    api.addOutputWithScript(scriptHex, value, asset)
  }

  if (changeAmount > 0n) {
    const changeScriptHex = getScriptHexFromVout(feeUtxo.prevout)
    api.addOutputWithScript(changeScriptHex, changeAmount, policyAssetHex)
  }
  api.addFeeOutput(feeAmount)

  const { pset } = api.build()

  const prevouts: EsploraVout[] = [
    issuanceUtxos[0].prevout,
    issuanceUtxos[1].prevout,
    issuanceUtxos[2].prevout,
    issuanceUtxos[3].prevout,
    feeUtxo.prevout,
  ]

  const { getLwk } = await import('../simplicity')
  const lwk = await getLwk()
  const signedTxHex = signP2pkInputs({
    lwk,
    network: networkKey,
    pset: pset as PsetWithExtractTx,
    secretKey,
    prevouts,
  })

  return { signedTxHex }
}
