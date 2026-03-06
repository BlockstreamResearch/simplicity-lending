/**
 * Build and sign the "Issue Utility NFTs" transaction.
 * Mirrors crates/contracts/src/sdk/pre_lock/utility_nfts_issuing.rs:
 * 4 inputs with NFT issuance (Borrower, Lender, First Params, Second Params) + 1 fee input;
 * 4 NFT outputs + 4 return outputs + optional change + fee output.
 */

import type { P2pkNetwork } from '../../simplicity'
import type { EsploraVout } from '../../api/esplora'
import { createPsetBuilder } from '../psetBuilder'
import type { PsetWithExtractTx } from '../../simplicity'
import { signP2pkInputs } from '../../utility/signP2pkInputs'
import { getScriptHexFromVout } from '../../utility/hex'

/** Number of NFT outputs (vout 0..3). The 4 return auxiliary UTXOs follow at vout 4..7. */
export const ISSUANCE_TX_NUM_NFT_OUTPUTS = 4

/** First vout of the 4 return (reusable) auxiliary UTXOs in the Issue Utility NFTs tx. */
export const ISSUANCE_TX_FIRST_RETURN_VOUT = ISSUANCE_TX_NUM_NFT_OUTPUTS

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
  network: P2pkNetwork
}

export interface BuildIssueUtilityNftsTxResult {
  pset: unknown
  unsignedTxHex: string
  prevouts: EsploraVout[]
}

export interface FinalizeIssueUtilityNftsTxParams {
  pset: PsetWithExtractTx
  prevouts: EsploraVout[]
  secretKey: Uint8Array
  network: P2pkNetwork
}

/**
 * Build Issue Utility NFTs PSET (no signing). Returns pset, unsignedTxHex, prevouts.
 */
export async function buildIssueUtilityNftsTx(
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
    network,
  } = params

  const feeValue = BigInt(feeUtxo.prevout.value ?? 0)
  if (feeValue < feeAmount) {
    throw new Error(`Fee UTXO value ${feeValue} is less than fee ${feeAmount}`)
  }
  const changeAmount = feeValue - feeAmount

  const networkKey = network === 'mainnet' ? 'mainnet' : 'testnet'
  const api = await createPsetBuilder(networkKey)

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

  api.addOutputToAddress(utilityNftsToAddress, 1n, borrowerAssetId)
  api.addOutputToAddress(utilityNftsToAddress, 1n, lenderAssetId)
  api.addOutputToAddress(utilityNftsToAddress, firstParametersNftAmount, firstParamsAssetId)
  api.addOutputToAddress(utilityNftsToAddress, secondParametersNftAmount, secondParamsAssetId)

  const policyAssetHex = api.getPolicyAssetHex()
  for (let i = 0; i < ISSUANCE_TX_NUM_NFT_OUTPUTS; i++) {
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
  const unsignedTxHex = (pset as PsetWithExtractTx).extractTx().toString()
  return { pset, unsignedTxHex, prevouts }
}

/**
 * Finalize (sign) Issue Utility NFTs PSET and return signed tx hex.
 */
export async function finalizeIssueUtilityNftsTx(
  params: FinalizeIssueUtilityNftsTxParams
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

export interface BuildAndSignIssueUtilityNftsTxParams extends BuildIssueUtilityNftsTxParams {
  secretKey: Uint8Array
}

export interface BuildAndSignIssueUtilityNftsTxResult {
  signedTxHex: string
}

/**
 * Build and sign the Issue Utility NFTs tx; returns signed tx hex.
 */
export async function buildAndSignIssueUtilityNftsTx(
  params: BuildAndSignIssueUtilityNftsTxParams
): Promise<BuildAndSignIssueUtilityNftsTxResult> {
  const built = await buildIssueUtilityNftsTx(params)
  const signedTxHex = await finalizeIssueUtilityNftsTx({
    pset: built.pset as PsetWithExtractTx,
    prevouts: built.prevouts,
    secretKey: params.secretKey,
    network: params.network,
  })
  return { signedTxHex }
}
