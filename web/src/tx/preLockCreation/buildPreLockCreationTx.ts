/**
 * Build and sign the PreLock creation (Finalize offer) transaction.
 * Mirrors crates/contracts/src/sdk/pre_lock/creation.rs:
 * 6 inputs (collateral, first params NFT, second params NFT, borrower NFT, lender NFT, fee),
 * outputs: PreLock, 4× NFT, OP_RETURN, optional collateral change, optional fee change, fee.
 * All 6 inputs are P2PK, signed with signP2pkInputs.
 */

import type { EsploraVout } from '../../api/esplora'
import { createPsetBuilder } from '../psetBuilder'
import type { PsetWithExtractTx, P2pkNetwork } from '../../simplicity'
import { signP2pkInputs } from '../../utility/signP2pkInputs'
import type { PreLockArguments } from '../../utility/preLockArguments'
import { getScriptHexFromVout, bytesToHex } from '../../utility/hex'

/** OP_RETURN with 64 bytes: borrower_pub_key (32) || principal_asset_id (32). */
function buildOpReturn64ScriptHex(
  borrowerPubKey: Uint8Array,
  principalAssetId: Uint8Array
): string {
  if (borrowerPubKey.length !== 32 || principalAssetId.length !== 32) {
    throw new Error('OP_RETURN data must be 32+32 bytes')
  }
  const data = new Uint8Array(64)
  data.set(borrowerPubKey, 0)
  data.set(principalAssetId, 32)
  return '6a40' + bytesToHex(data)
}

export interface PreLockCreationUtxo {
  outpoint: { txid: string; vout: number }
  prevout: EsploraVout
}

export interface BuildPreLockCreationTxParams {
  collateralUtxo: PreLockCreationUtxo
  firstParametersNftUtxo: PreLockCreationUtxo
  secondParametersNftUtxo: PreLockCreationUtxo
  borrowerNftUtxo: PreLockCreationUtxo
  lenderNftUtxo: PreLockCreationUtxo
  feeUtxo: PreLockCreationUtxo
  preLockArguments: PreLockArguments
  preLockScriptPubkeyHex: string
  utilityNftsOutputScriptHex: string
  feeAmount: bigint
  network: P2pkNetwork
}

export interface BuildPreLockCreationTxResult {
  pset: unknown
  unsignedTxHex: string
  prevouts: EsploraVout[]
}

export interface FinalizePreLockCreationTxParams {
  pset: PsetWithExtractTx
  prevouts: EsploraVout[]
  secretKey: Uint8Array
  network: P2pkNetwork
}

export interface FinalizePreLockCreationTxResult {
  signedTxHex: string
}

/**
 * Build (unsigned) PreLock creation tx. Returns PSET, unsigned hex, and prevouts for finalize.
 */
export async function buildPreLockCreationTx(
  params: BuildPreLockCreationTxParams
): Promise<BuildPreLockCreationTxResult> {
  const {
    collateralUtxo,
    firstParametersNftUtxo,
    secondParametersNftUtxo,
    borrowerNftUtxo,
    lenderNftUtxo,
    feeUtxo,
    preLockArguments,
    preLockScriptPubkeyHex,
    utilityNftsOutputScriptHex,
    feeAmount,
    network,
  } = params

  const collateralValue = BigInt(collateralUtxo.prevout.value ?? 0)
  const collateralAmount = preLockArguments.collateralAmount
  if (collateralValue < collateralAmount) {
    throw new Error(
      `Collateral UTXO value ${collateralValue} is less than required ${collateralAmount}`
    )
  }
  const collateralChange = collateralValue - collateralAmount

  const feeValue = BigInt(feeUtxo.prevout.value ?? 0)
  if (feeValue < feeAmount) {
    throw new Error(`Fee UTXO value ${feeValue} is less than fee ${feeAmount}`)
  }
  const feeChange = feeValue - feeAmount

  const networkKey = network === 'mainnet' ? 'mainnet' : 'testnet'
  const api = await createPsetBuilder(networkKey)
  const policyAssetHex = api.getPolicyAssetHex()

  function requireAsset(vout: EsploraVout, label: string): string {
    const hex = vout.asset?.trim().toLowerCase().replace(/^0x/, '')
    if (!hex || hex.length !== 64) {
      throw new Error(`${label} prevout must have explicit 32-byte asset (64 hex chars)`)
    }
    return hex
  }
  const collateralAssetHex = requireAsset(collateralUtxo.prevout, 'Collateral')
  const firstParamsAssetHex = requireAsset(firstParametersNftUtxo.prevout, 'First parameters NFT')
  const secondParamsAssetHex = requireAsset(
    secondParametersNftUtxo.prevout,
    'Second parameters NFT'
  )
  const borrowerNftAssetHex = requireAsset(borrowerNftUtxo.prevout, 'Borrower NFT')
  const lenderNftAssetHex = requireAsset(lenderNftUtxo.prevout, 'Lender NFT')
  requireAsset(feeUtxo.prevout, 'Fee')

  const firstParamsValue = BigInt(firstParametersNftUtxo.prevout.value ?? 0)
  const secondParamsValue = BigInt(secondParametersNftUtxo.prevout.value ?? 0)
  if (firstParamsValue < 1n || secondParamsValue < 1n) {
    throw new Error('Parameter NFT prevouts must have value at least 1')
  }
  const borrowerNftValue = BigInt(borrowerNftUtxo.prevout.value ?? 0)
  const lenderNftValue = BigInt(lenderNftUtxo.prevout.value ?? 0)
  if (borrowerNftValue !== 1n || lenderNftValue !== 1n) {
    throw new Error('Borrower and Lender NFT prevouts must have value 1')
  }

  const txidTrim = (txid: string) => txid.trim()
  api.addInput(
    { txid: txidTrim(collateralUtxo.outpoint.txid), vout: collateralUtxo.outpoint.vout },
    collateralUtxo.prevout
  )
  api.addInput(
    {
      txid: txidTrim(firstParametersNftUtxo.outpoint.txid),
      vout: firstParametersNftUtxo.outpoint.vout,
    },
    firstParametersNftUtxo.prevout
  )
  api.addInput(
    {
      txid: txidTrim(secondParametersNftUtxo.outpoint.txid),
      vout: secondParametersNftUtxo.outpoint.vout,
    },
    secondParametersNftUtxo.prevout
  )
  api.addInput(
    { txid: txidTrim(borrowerNftUtxo.outpoint.txid), vout: borrowerNftUtxo.outpoint.vout },
    borrowerNftUtxo.prevout
  )
  api.addInput(
    { txid: txidTrim(lenderNftUtxo.outpoint.txid), vout: lenderNftUtxo.outpoint.vout },
    lenderNftUtxo.prevout
  )
  api.addInput(
    { txid: txidTrim(feeUtxo.outpoint.txid), vout: feeUtxo.outpoint.vout },
    feeUtxo.prevout
  )

  // Output 0: PreLock + collateral
  api.addOutputWithScript(preLockScriptPubkeyHex, collateralAmount, collateralAssetHex)
  // Outputs 1–4: 4 NFTs to utility script
  api.addOutputWithScript(utilityNftsOutputScriptHex, firstParamsValue, firstParamsAssetHex)
  api.addOutputWithScript(utilityNftsOutputScriptHex, secondParamsValue, secondParamsAssetHex)
  api.addOutputWithScript(utilityNftsOutputScriptHex, 1n, borrowerNftAssetHex)
  api.addOutputWithScript(utilityNftsOutputScriptHex, 1n, lenderNftAssetHex)
  // Output 5: OP_RETURN 64 bytes
  const opReturnScriptHex = buildOpReturn64ScriptHex(
    preLockArguments.borrowerPubKey,
    preLockArguments.principalAssetId
  )
  api.addOutputWithScript(opReturnScriptHex, 0n, policyAssetHex)
  // Optional collateral change
  if (collateralChange > 0n) {
    api.addOutputWithScript(
      getScriptHexFromVout(collateralUtxo.prevout),
      collateralChange,
      collateralAssetHex
    )
  }
  // Optional fee change
  if (feeChange > 0n) {
    api.addOutputWithScript(getScriptHexFromVout(feeUtxo.prevout), feeChange, policyAssetHex)
  }
  api.addFeeOutput(feeAmount)

  const { pset } = api.build()

  const prevouts: EsploraVout[] = [
    collateralUtxo.prevout,
    firstParametersNftUtxo.prevout,
    secondParametersNftUtxo.prevout,
    borrowerNftUtxo.prevout,
    lenderNftUtxo.prevout,
    feeUtxo.prevout,
  ]

  const unsignedTxHex = (pset as PsetWithExtractTx).extractTx().toString()
  return { pset, unsignedTxHex, prevouts }
}

/**
 * Finalize (sign) a PreLock creation PSET. All 6 inputs are P2PK.
 */
export async function finalizePreLockCreationTx(
  params: FinalizePreLockCreationTxParams
): Promise<FinalizePreLockCreationTxResult> {
  const { pset, prevouts, secretKey, network } = params
  const networkKey: 'mainnet' | 'testnet' = network === 'mainnet' ? 'mainnet' : 'testnet'
  const { getLwk } = await import('../../simplicity')
  const lwk = await getLwk()
  const signedTxHex = signP2pkInputs({
    lwk,
    network: networkKey,
    pset,
    secretKey,
    prevouts,
  })
  return { signedTxHex }
}

/**
 * Build and sign the PreLock creation tx; returns signed tx hex.
 * Wrapper: buildPreLockCreationTx + finalizePreLockCreationTx.
 */
export async function buildAndSignPreLockCreationTx(
  params: BuildPreLockCreationTxParams & { secretKey: Uint8Array }
): Promise<FinalizePreLockCreationTxResult> {
  const { secretKey, ...buildParams } = params
  const { pset, prevouts } = await buildPreLockCreationTx(buildParams)
  return finalizePreLockCreationTx({
    pset: pset as PsetWithExtractTx,
    prevouts,
    secretKey,
    network: buildParams.network,
  })
}
