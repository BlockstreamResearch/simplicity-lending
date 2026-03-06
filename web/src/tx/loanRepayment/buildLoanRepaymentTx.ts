/**
 * Build (unsigned) Loan Repayment transaction: spend Lending covenant + 3 NFT UTXOs + principal UTXO(s) + fee.
 * Mirrors crates/contracts/src/sdk/lending/loan_repayment.rs; web extends to multiple principal inputs + principal change.
 *
 * Input order: 0=Lending, 1=FirstParams NFT, 2=SecondParams NFT, 3=Borrower NFT, 4..K+3=Principal UTXOs, K+4=Fee.
 * Output order: Collateral to borrower, Principal (exact principal_with_interest) to AssetAuth (lender), 3 burns, [principal change], [fee change], fee.
 * No locktime.
 */

import type { EsploraTx, EsploraVout } from '../../api/esplora'
import type { OfferShort } from '../../types/offers'
import type { P2pkNetwork, PsetWithExtractTx } from '../../simplicity'
import { createPsetBuilder } from '../psetBuilder'
import { getLwk, getSource, createP2trAddress } from '../../simplicity'
import { getScriptHexFromVout, assetIdDisplayToInternal } from '../../utility/hex'
import {
  OP_RETURN_BURN_SCRIPT_HEX,
  requireVout,
  requireAssetHex,
  requireValue,
  normalizeAssetHex,
} from '../../utility/esploraPrevout'
import { hashScriptPubkeyHex } from '../../api/esplora'
import { buildLendingArguments, buildAssetAuthArguments } from '../../simplicity/covenants'
import { getTaprootUnspendableInternalKey } from '../../utility/taprootUnspendableKey'
import { calculatePrincipalWithInterest } from './principalWithInterest'

export interface LoanRepaymentPrincipalUtxo {
  outpoint: { txid: string; vout: number }
  prevout: EsploraVout
}

export interface BuildLoanRepaymentTxParams {
  /** Lending creation tx (accept-offer tx). Vouts: 0=Lending, 2=FirstParams, 3=SecondParams, 4=Borrower NFT, 5=Lender NFT (asset only). */
  lendingTx: EsploraTx
  /** Current Borrower NFT UTXO (from indexer participants). */
  borrowerNftUtxo: { outpoint: { txid: string; vout: number }; prevout: EsploraVout }
  /** Principal UTXOs (principal asset). Sum must be >= principal_with_interest. */
  principalUtxos: LoanRepaymentPrincipalUtxo[]
  /** Fee UTXO (LBTC). */
  feeUtxo: { outpoint: { txid: string; vout: number }; prevout: EsploraVout }
  feeAmount: bigint
  /** Collateral destination script (hex). Typically borrower's address. */
  collateralOutputScriptHex: string
  /** Principal change script (hex). Where to send principal excess. */
  principalChangeScriptHex: string
  offer: OfferShort
  network: P2pkNetwork
}

export interface BuildLoanRepaymentTxResult {
  pset: unknown
  unsignedTxHex: string
  /** Prevouts in input order: Lending, FirstParams, SecondParams, Borrower NFT, ...principalUtxos, Fee. */
  prevouts: EsploraVout[]
  lendingCovHash: Uint8Array
  lendingArgs: {
    collateralAssetId: Uint8Array
    principalAssetId: Uint8Array
    borrowerNftAssetId: Uint8Array
    lenderNftAssetId: Uint8Array
    firstParametersNftAssetId: Uint8Array
    secondParametersNftAssetId: Uint8Array
    lenderPrincipalCovHash: Uint8Array
    lendingParams: {
      collateralAmount: bigint
      principalAmount: bigint
      loanExpirationTime: number
      principalInterestRate: number
    }
  }
}

export async function buildLoanRepaymentTx(
  params: BuildLoanRepaymentTxParams
): Promise<BuildLoanRepaymentTxResult> {
  const {
    lendingTx,
    borrowerNftUtxo,
    principalUtxos,
    feeUtxo,
    feeAmount,
    collateralOutputScriptHex,
    principalChangeScriptHex,
    offer,
    network,
  } = params

  if (principalUtxos.length === 0) throw new Error('At least one principal UTXO is required')
  if (feeAmount <= 0n) throw new Error('Fee amount must be at least 1')

  const principalWithInterest = calculatePrincipalWithInterest(
    offer.principal_amount,
    offer.interest_rate
  )

  const lendingPrevout = requireVout(lendingTx, 0, 'Lending', 'lending tx')
  const firstParamsPrevout = requireVout(lendingTx, 2, 'First parameters NFT', 'lending tx')
  const secondParamsPrevout = requireVout(lendingTx, 3, 'Second parameters NFT', 'lending tx')
  const borrowerNftPrevout = borrowerNftUtxo.prevout
  const lenderNftPrevout = requireVout(lendingTx, 5, 'Lender NFT', 'lending tx')

  const lendingAssetHex = requireAssetHex(lendingPrevout, 'Lending')
  const lendingValue = requireValue(lendingPrevout, 'Lending')
  const firstParamsAssetHex = requireAssetHex(firstParamsPrevout, 'First parameters NFT')
  const firstParamsValue = requireValue(firstParamsPrevout, 'First parameters NFT')
  const secondParamsAssetHex = requireAssetHex(secondParamsPrevout, 'Second parameters NFT')
  const secondParamsValue = requireValue(secondParamsPrevout, 'Second parameters NFT')
  const borrowerNftAssetHex = requireAssetHex(borrowerNftPrevout, 'Borrower NFT')
  const borrowerNftValue = requireValue(borrowerNftPrevout, 'Borrower NFT')
  const lenderNftAssetHex = requireAssetHex(lenderNftPrevout, 'Lender NFT')
  const feeAssetHex = requireAssetHex(feeUtxo.prevout, 'Fee')
  const feeValue = requireValue(feeUtxo.prevout, 'Fee')

  const principalAssetHex = normalizeAssetHex(offer.principal_asset)
  let principalSum = 0n
  for (const u of principalUtxos) {
    const ah = normalizeAssetHex(u.prevout.asset ?? '')
    if (ah !== principalAssetHex) {
      throw new Error('Principal UTXO asset does not match offer principal asset')
    }
    principalSum += requireValue(u.prevout, 'Principal')
  }
  if (principalSum < principalWithInterest) {
    throw new Error(
      `Principal UTXOs sum ${principalSum} is less than principal+interest ${principalWithInterest}`
    )
  }

  if (normalizeAssetHex(offer.collateral_asset) !== normalizeAssetHex(lendingAssetHex)) {
    throw new Error('Lending UTXO asset does not match offer collateral asset')
  }
  if (lendingValue !== offer.collateral_amount) {
    throw new Error('Lending UTXO value does not match offer collateral amount')
  }
  if (borrowerNftValue !== 1n) throw new Error('Borrower NFT prevout must have value 1')
  if (feeValue < feeAmount) {
    throw new Error(`Fee UTXO value ${feeValue} is less than fee ${feeAmount}`)
  }

  const lendingParams = {
    collateralAmount: offer.collateral_amount,
    principalAmount: offer.principal_amount,
    loanExpirationTime: offer.loan_expiration_time,
    principalInterestRate: offer.interest_rate,
  }

  const lwk = await getLwk()
  const internalKey = getTaprootUnspendableInternalKey(lwk)
  const collateralAssetId = assetIdDisplayToInternal(offer.collateral_asset)
  const principalAssetId = assetIdDisplayToInternal(offer.principal_asset)
  const borrowerNftAssetId = assetIdDisplayToInternal(borrowerNftAssetHex)
  const lenderNftAssetId = assetIdDisplayToInternal(lenderNftAssetHex)
  const firstParametersNftAssetId = assetIdDisplayToInternal(firstParamsAssetHex)
  const secondParametersNftAssetId = assetIdDisplayToInternal(secondParamsAssetHex)

  const assetAuthArgs = buildAssetAuthArguments(lwk, {
    assetId: lenderNftAssetId,
    assetAmount: 1,
    withAssetBurn: true,
  })
  const assetAuthAddress = await createP2trAddress({
    source: getSource('asset_auth'),
    args: assetAuthArgs,
    internalKey,
    network,
  })
  const { getScriptPubkeyHexFromAddress } = await import('../../utility/addressP2pk')
  const principalAuthScriptHex = await getScriptPubkeyHexFromAddress(assetAuthAddress)
  const lenderPrincipalCovHash = await hashScriptPubkeyHex(principalAuthScriptHex)

  const lendingArgs = buildLendingArguments(lwk, {
    collateralAssetId,
    principalAssetId,
    borrowerNftAssetId,
    lenderNftAssetId,
    firstParametersNftAssetId,
    secondParametersNftAssetId,
    lenderPrincipalCovHash,
    lendingParams,
  })
  const lendingAddress = await createP2trAddress({
    source: getSource('lending'),
    args: lendingArgs,
    internalKey,
    network,
  })
  const lendingScriptPubkeyHex = await getScriptPubkeyHexFromAddress(lendingAddress)
  const lendingCovHash = await hashScriptPubkeyHex(lendingScriptPubkeyHex)

  const networkKey: 'mainnet' | 'testnet' = network === 'mainnet' ? 'mainnet' : 'testnet'
  const api = await createPsetBuilder(networkKey)
  const policyAssetHex = api.getPolicyAssetHex()
  if (normalizeAssetHex(policyAssetHex) !== normalizeAssetHex(feeAssetHex)) {
    throw new Error('Fee UTXO must be policy asset (LBTC)')
  }

  const txid = lendingTx.txid.trim()
  api.addInput({ txid, vout: 0 }, lendingPrevout)
  api.addInput({ txid, vout: 2 }, firstParamsPrevout)
  api.addInput({ txid, vout: 3 }, secondParamsPrevout)
  api.addInput(borrowerNftUtxo.outpoint, borrowerNftPrevout)
  for (const u of principalUtxos) {
    api.addInput(u.outpoint, u.prevout)
  }
  api.addInput(feeUtxo.outpoint, feeUtxo.prevout)

  api.addOutputWithScript(collateralOutputScriptHex, lendingValue, lendingAssetHex)
  api.addOutputWithScript(principalAuthScriptHex, principalWithInterest, principalAssetHex)
  api.addOutputWithScript(OP_RETURN_BURN_SCRIPT_HEX, firstParamsValue, firstParamsAssetHex)
  api.addOutputWithScript(OP_RETURN_BURN_SCRIPT_HEX, secondParamsValue, secondParamsAssetHex)
  api.addOutputWithScript(OP_RETURN_BURN_SCRIPT_HEX, borrowerNftValue, borrowerNftAssetHex)

  const principalChange = principalSum - principalWithInterest
  if (principalChange > 0n) {
    api.addOutputWithScript(principalChangeScriptHex, principalChange, principalAssetHex)
  }

  const totalLbtcLeft = feeValue - feeAmount
  if (totalLbtcLeft > 0n) {
    api.addOutputWithScript(getScriptHexFromVout(feeUtxo.prevout), totalLbtcLeft, policyAssetHex)
  }
  api.addFeeOutput(feeAmount)

  const { pset } = api.build()
  const unsignedTxHex = (pset as PsetWithExtractTx).extractTx().toString()

  const prevouts: EsploraVout[] = [
    lendingPrevout,
    firstParamsPrevout,
    secondParamsPrevout,
    borrowerNftPrevout,
    ...principalUtxos.map((u) => u.prevout),
    feeUtxo.prevout,
  ]

  return {
    pset,
    unsignedTxHex,
    prevouts,
    lendingCovHash,
    lendingArgs: {
      collateralAssetId,
      principalAssetId,
      borrowerNftAssetId,
      lenderNftAssetId,
      firstParametersNftAssetId,
      secondParametersNftAssetId,
      lenderPrincipalCovHash,
      lendingParams,
    },
  }
}
