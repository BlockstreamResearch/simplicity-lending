/**
 * Build (unsigned) PreLock cancellation transaction: spend PreLock + 4 NFTs + fee, return collateral to borrower.
 * Mirrors crates/contracts/src/sdk/pre_lock/cancellation.rs build_pre_lock_cancellation.
 *
 * Input order: 0=PreLock, 1=FirstParams NFT, 2=SecondParams NFT, 3=Borrower NFT, 4=Lender NFT, 5=Fee.
 * Output order: Collateral to user, 4× burn, fee change (if any), fee.
 */

import type { EsploraTx, EsploraVout } from '../../api/esplora'
import type { OfferShort } from '../../types/offers'
import type { PreLockArguments } from '../../utility/preLockArguments'
import type { P2pkNetwork, PsetWithExtractTx } from '../../simplicity'
import { createPsetBuilder } from '../psetBuilder'
import { getScriptHexFromVout } from '../../utility/hex'
import { assetIdDisplayToInternal } from '../../utility/hex'
import {
  OP_RETURN_BURN_SCRIPT_HEX,
  requireVout,
  requireAssetHex,
  requireValue,
  normalizeAssetHex,
} from '../../utility/esploraPrevout'

export interface CancellationUtxo {
  outpoint: { txid: string; vout: number }
  prevout: EsploraVout
}

export interface BuildPreLockCancellationTxParams {
  offer: OfferShort
  /** Offer creation tx (PreLock creation). Vouts: 0=PreLock, 1=FirstParams, 2=SecondParams, 3=Borrower NFT, 4=Lender NFT. */
  offerCreationTx: EsploraTx
  /** Collateral destination script (hex). Typically borrower's address script. */
  collateralOutputScriptHex: string
  feeUtxo: CancellationUtxo
  feeAmount: bigint
  preLockArguments: PreLockArguments
  network: P2pkNetwork
}

export interface BuildPreLockCancellationTxResult {
  pset: unknown
  unsignedTxHex: string
  /** Prevouts in input order (6): PreLock, FirstParams, SecondParams, Borrower NFT, Lender NFT, Fee. */
  prevouts: EsploraVout[]
}

function checkAssetMatch(
  voutAssetDisplayHex: string,
  expectedInternal: Uint8Array,
  label: string
): void {
  const voutInternal = assetIdDisplayToInternal(voutAssetDisplayHex)
  if (
    voutInternal.length !== expectedInternal.length ||
    voutInternal.some((b, i) => b !== expectedInternal[i])
  ) {
    throw new Error(`${label} asset mismatch`)
  }
}

export async function buildPreLockCancellationTx(
  params: BuildPreLockCancellationTxParams
): Promise<BuildPreLockCancellationTxResult> {
  const {
    offer,
    offerCreationTx,
    collateralOutputScriptHex,
    feeUtxo,
    feeAmount,
    preLockArguments,
    network,
  } = params

  if (feeAmount <= 0n) throw new Error('Fee amount must be at least 1')

  const txid = offerCreationTx.txid.trim()
  const preLockPrevout = requireVout(offerCreationTx, 0, 'PreLock', 'offer creation tx')
  const firstParamsPrevout = requireVout(
    offerCreationTx,
    1,
    'First parameters NFT',
    'offer creation tx'
  )
  const secondParamsPrevout = requireVout(
    offerCreationTx,
    2,
    'Second parameters NFT',
    'offer creation tx'
  )
  const borrowerNftPrevout = requireVout(offerCreationTx, 3, 'Borrower NFT', 'offer creation tx')
  const lenderNftPrevout = requireVout(offerCreationTx, 4, 'Lender NFT', 'offer creation tx')

  const preLockAssetHex = requireAssetHex(preLockPrevout, 'PreLock')
  const preLockValue = requireValue(preLockPrevout, 'PreLock')
  const firstParamsAssetHex = requireAssetHex(firstParamsPrevout, 'First parameters NFT')
  const firstParamsValue = requireValue(firstParamsPrevout, 'First parameters NFT')
  const secondParamsAssetHex = requireAssetHex(secondParamsPrevout, 'Second parameters NFT')
  const secondParamsValue = requireValue(secondParamsPrevout, 'Second parameters NFT')
  const borrowerNftAssetHex = requireAssetHex(borrowerNftPrevout, 'Borrower NFT')
  const borrowerNftValue = requireValue(borrowerNftPrevout, 'Borrower NFT')
  const lenderNftAssetHex = requireAssetHex(lenderNftPrevout, 'Lender NFT')
  const lenderNftValue = requireValue(lenderNftPrevout, 'Lender NFT')
  const feeAssetHex = requireAssetHex(feeUtxo.prevout, 'Fee')
  const feeValue = requireValue(feeUtxo.prevout, 'Fee')

  checkAssetMatch(preLockAssetHex, preLockArguments.collateralAssetId, 'PreLock')
  checkAssetMatch(
    firstParamsAssetHex,
    preLockArguments.firstParametersNftAssetId,
    'First parameters NFT'
  )
  checkAssetMatch(
    secondParamsAssetHex,
    preLockArguments.secondParametersNftAssetId,
    'Second parameters NFT'
  )
  checkAssetMatch(borrowerNftAssetHex, preLockArguments.borrowerNftAssetId, 'Borrower NFT')
  checkAssetMatch(lenderNftAssetHex, preLockArguments.lenderNftAssetId, 'Lender NFT')

  if (preLockValue !== offer.collateral_amount) {
    throw new Error('PreLock value does not match offer collateral amount')
  }
  if (borrowerNftValue !== 1n || lenderNftValue !== 1n) {
    throw new Error('Borrower and Lender NFT prevouts must have value 1')
  }
  if (feeValue < feeAmount) {
    throw new Error(`Fee UTXO value ${feeValue} is less than fee ${feeAmount}`)
  }

  const networkKey: 'mainnet' | 'testnet' = network === 'mainnet' ? 'mainnet' : 'testnet'
  const api = await createPsetBuilder(networkKey)
  const policyAssetHex = api.getPolicyAssetHex()
  if (normalizeAssetHex(policyAssetHex) !== normalizeAssetHex(feeAssetHex)) {
    throw new Error('Fee UTXO must be policy asset (LBTC)')
  }

  api.addInput({ txid, vout: 0 }, preLockPrevout)
  api.addInput({ txid, vout: 1 }, firstParamsPrevout)
  api.addInput({ txid, vout: 2 }, secondParamsPrevout)
  api.addInput({ txid, vout: 3 }, borrowerNftPrevout)
  api.addInput({ txid, vout: 4 }, lenderNftPrevout)
  api.addInput(feeUtxo.outpoint, feeUtxo.prevout)

  api.addOutputWithScript(collateralOutputScriptHex, preLockValue, preLockAssetHex)
  api.addOutputWithScript(OP_RETURN_BURN_SCRIPT_HEX, firstParamsValue, firstParamsAssetHex)
  api.addOutputWithScript(OP_RETURN_BURN_SCRIPT_HEX, secondParamsValue, secondParamsAssetHex)
  api.addOutputWithScript(OP_RETURN_BURN_SCRIPT_HEX, borrowerNftValue, borrowerNftAssetHex)
  api.addOutputWithScript(OP_RETURN_BURN_SCRIPT_HEX, lenderNftValue, lenderNftAssetHex)

  const totalLbtcLeft = feeValue - feeAmount
  if (totalLbtcLeft > 0n) {
    api.addOutputWithScript(getScriptHexFromVout(feeUtxo.prevout), totalLbtcLeft, policyAssetHex)
  }
  api.addFeeOutput(feeAmount)

  const { pset } = api.build()
  const unsignedTxHex = (pset as PsetWithExtractTx).extractTx().toString()

  const prevouts: EsploraVout[] = [
    preLockPrevout,
    firstParamsPrevout,
    secondParamsPrevout,
    borrowerNftPrevout,
    lenderNftPrevout,
    feeUtxo.prevout,
  ]

  return { pset, unsignedTxHex, prevouts }
}
