/**
 * Build (unsigned) Loan Liquidation transaction: spend Lending covenant + 3 NFT UTXOs + fee.
 * Mirrors crates/contracts/src/sdk/lending/loan_liquidation.rs.
 *
 * Input order: 0=Lending (with height locktime), 1=FirstParams NFT, 2=SecondParams NFT, 3=Lender NFT, 4=Fee.
 * Output order: Collateral to lender, FirstParams burn, SecondParams burn, Lender NFT burn, [change], fee.
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

export interface LoanLiquidationUtxo {
  outpoint: { txid: string; vout: number }
  prevout: EsploraVout
}

export interface BuildLoanLiquidationTxParams {
  /** Lending creation tx (accept-offer tx). Vouts: 0=Lending, 1=FirstParams, 2=SecondParams; vout 3=Borrower NFT (asset only). */
  lendingTx: EsploraTx
  /** Current Lender NFT UTXO (from indexer participants — may have moved since accept-offer). */
  lenderNftUtxo: LoanLiquidationUtxo
  /** Fee UTXO (LBTC). */
  feeUtxo: LoanLiquidationUtxo
  feeAmount: bigint
  /** Collateral destination script (hex). Typically lender's P2PK script. */
  collateralOutputScriptHex: string
  offer: OfferShort
  network: P2pkNetwork
}

export interface BuildLoanLiquidationTxResult {
  pset: unknown
  unsignedTxHex: string
  /** Prevouts in input order (5): Lending, FirstParams, SecondParams, LenderNFT, Fee. */
  prevouts: EsploraVout[]
  /** For finalization: Lending covenant script hash (ScriptAuth for the 3 NFT inputs). */
  lendingCovHash: Uint8Array
  /** For finalization: Lending program args (rebuilt for witness). */
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

export async function buildLoanLiquidationTx(
  params: BuildLoanLiquidationTxParams
): Promise<BuildLoanLiquidationTxResult> {
  const {
    lendingTx,
    lenderNftUtxo,
    feeUtxo,
    feeAmount,
    collateralOutputScriptHex,
    offer,
    network,
  } = params

  if (feeAmount <= 0n) throw new Error('Fee amount must be at least 1')

  // Lending creation tx vouts: 0=Lending, 1=First params, 2=Second params, 3=Borrower NFT (asset id only). Lender NFT from lenderNftUtxo (indexer).
  const lendingPrevout = requireVout(lendingTx, 0, 'Lending', 'lending tx')
  const firstParamsPrevout = requireVout(lendingTx, 1, 'First parameters NFT', 'lending tx')
  const secondParamsPrevout = requireVout(lendingTx, 2, 'Second parameters NFT', 'lending tx')
  const lenderNftPrevout = lenderNftUtxo.prevout

  const lendingAssetHex = requireAssetHex(lendingPrevout, 'Lending')
  const lendingValue = requireValue(lendingPrevout, 'Lending')
  const firstParamsAssetHex = requireAssetHex(firstParamsPrevout, 'First parameters NFT')
  const firstParamsValue = requireValue(firstParamsPrevout, 'First parameters NFT')
  const secondParamsAssetHex = requireAssetHex(secondParamsPrevout, 'Second parameters NFT')
  const secondParamsValue = requireValue(secondParamsPrevout, 'Second parameters NFT')
  const lenderNftAssetHex = requireAssetHex(lenderNftPrevout, 'Lender NFT')
  const lenderNftValue = requireValue(lenderNftPrevout, 'Lender NFT')
  const feeAssetHex = requireAssetHex(feeUtxo.prevout, 'Fee')
  const feeValue = requireValue(feeUtxo.prevout, 'Fee')

  if (normalizeAssetHex(offer.collateral_asset) !== normalizeAssetHex(lendingAssetHex)) {
    throw new Error('Lending UTXO asset does not match offer collateral asset')
  }
  if (lendingValue !== offer.collateral_amount) {
    throw new Error('Lending UTXO value does not match offer collateral amount')
  }
  if (lenderNftValue !== 1n) {
    throw new Error('Lender NFT prevout must have value 1')
  }
  if (feeValue < feeAmount) {
    throw new Error(`Fee UTXO value ${feeValue} is less than fee ${feeAmount}`)
  }

  // Borrower NFT asset from same tx (vout 3) for Lending args
  const borrowerNftPrevout = requireVout(lendingTx, 3, 'Borrower NFT', 'lending tx')
  const borrowerNftAssetHex = requireAssetHex(borrowerNftPrevout, 'Borrower NFT')

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

  // Lender principal covenant hash (AssetAuth for lender NFT burn) - same as in accept-offer
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
  // All inputs need sequence enabling locktime so nLockTime is enforced (mirrors pst.rs ENABLE_LOCKTIME_NO_RBF for every input).
  api.addInputWithLocktimeSequence({ txid, vout: 0 }, lendingPrevout)
  api.addInputWithLocktimeSequence({ txid, vout: 1 }, firstParamsPrevout)
  api.addInputWithLocktimeSequence({ txid, vout: 2 }, secondParamsPrevout)
  api.addInputWithLocktimeSequence(lenderNftUtxo.outpoint, lenderNftPrevout)
  api.addInputWithLocktimeSequence(feeUtxo.outpoint, feeUtxo.prevout)

  api.addOutputWithScript(collateralOutputScriptHex, lendingValue, lendingAssetHex)
  api.addOutputWithScript(OP_RETURN_BURN_SCRIPT_HEX, firstParamsValue, firstParamsAssetHex)
  api.addOutputWithScript(OP_RETURN_BURN_SCRIPT_HEX, secondParamsValue, secondParamsAssetHex)
  api.addOutputWithScript(OP_RETURN_BURN_SCRIPT_HEX, lenderNftValue, lenderNftAssetHex)

  const totalLbtcLeft = feeValue - feeAmount
  if (totalLbtcLeft > 0n) {
    api.addOutputWithScript(getScriptHexFromVout(feeUtxo.prevout), totalLbtcLeft, policyAssetHex)
  }
  api.addFeeOutput(feeAmount)

  api.setFallbackLocktimeHeight(offer.loan_expiration_time)
  const { pset } = api.build()
  const unsignedTxHex = (pset as PsetWithExtractTx).extractTx().toString()

  const prevouts: EsploraVout[] = [
    lendingPrevout,
    firstParamsPrevout,
    secondParamsPrevout,
    lenderNftPrevout,
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
