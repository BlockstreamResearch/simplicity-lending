/**
 * PreLock covenant chain: AssetAuth → Lending → ScriptAuth (parameters) → PreLock → ScriptAuth (utility NFTs output).
 * Implemented with LWK: getSource, createP2trAddress, getScriptPubkeyHexFromAddress, hashScriptPubkeyHex.
 */

import type { EsploraTx } from '../api/esplora'
import { getSource, getLwk, createP2trAddress } from '../simplicity'
import type { P2pkNetwork } from '../simplicity'
import { getScriptPubkeyHexFromAddress } from './addressP2pk'
import { hashScriptPubkeyHex } from '../api/esplora'
import { getTaprootUnspendableInternalKey } from './taprootUnspendableKey'
import {
  buildAssetAuthArguments,
  buildLendingArguments,
  buildScriptAuthArguments,
  buildPreLockArguments as buildPreLockSimplicityArgs,
} from '../simplicity/covenants'
import { buildPreLockArguments as buildPreLockArgumentsObj } from './preLockArguments'
import type { LendingParams, PreLockArguments } from './preLockArguments'
import {
  assetIdDisplayToInternal,
  bytesToHex,
  getScriptHexFromVout,
  normalizeHex,
  parseOpReturn64,
} from './hex'
import { requireVout, requireAssetHex, requireVinPrevout } from './esploraPrevout'
import type { OfferShort } from '../types/offers'

export interface ComputePreLockCovenantHashesParams {
  collateralAssetId: Uint8Array
  principalAssetId: Uint8Array
  borrowerNftAssetId: Uint8Array
  lenderNftAssetId: Uint8Array
  firstParametersNftAssetId: Uint8Array
  secondParametersNftAssetId: Uint8Array
  lendingParams: LendingParams
  borrowerPubKey: Uint8Array
  borrowerOutputScriptHex: string
  network?: P2pkNetwork
}

export interface PreLockCovenantHashes {
  principalAuthScriptHash: Uint8Array
  lendingCovHash: Uint8Array
  parametersNftOutputScriptHash: Uint8Array
  /** Hash of borrower wallet output script (for principal and borrower NFT outputs). */
  borrowerOutputScriptHash: Uint8Array
  /** Hash of PreLock script (used for ScriptAuth utility NFTs). */
  preLockScriptHash: Uint8Array
  preLockAddressScriptPubkey?: Uint8Array
  utilityNftsOutputScriptPubkey?: Uint8Array
  /** Script pubkey hex for PreLock output (output 0). */
  preLockScriptPubkeyHex: string
  /** Script pubkey hex for the 4 NFT outputs (outputs 1–4). */
  utilityNftsOutputScriptHex: string
  /** Script pubkey hex for Lending covenant output (for Accept Offer). */
  lendingScriptPubkeyHex: string
  /** Script pubkey hex for parameters NFT outputs (ScriptAuth over Lending). */
  parametersNftScriptPubkeyHex: string
}

/**
 * Compute the covenant chain and return hashes plus script hexes for building the PreLock creation tx.
 */
export async function computePreLockCovenantHashes(
  params: ComputePreLockCovenantHashesParams
): Promise<PreLockCovenantHashes> {
  const network: P2pkNetwork = params.network ?? 'testnet'
  const lwk = await getLwk()
  const internalKey = getTaprootUnspendableInternalKey(lwk)

  // 1. AssetAuth (Lender NFT auth for claiming principal)
  const assetAuthArgs = buildAssetAuthArguments(lwk, {
    assetId: params.lenderNftAssetId,
    assetAmount: 1,
    withAssetBurn: true,
  })
  const assetAuthAddress = await createP2trAddress({
    source: getSource('asset_auth'),
    args: assetAuthArgs,
    internalKey,
    network,
  })
  const principalAuthScriptHex = await getScriptPubkeyHexFromAddress(assetAuthAddress)
  const principalAuthScriptHash = await hashScriptPubkeyHex(principalAuthScriptHex)

  // 2. Lending covenant
  const lendingArgs = buildLendingArguments(lwk, {
    collateralAssetId: params.collateralAssetId,
    principalAssetId: params.principalAssetId,
    borrowerNftAssetId: params.borrowerNftAssetId,
    lenderNftAssetId: params.lenderNftAssetId,
    firstParametersNftAssetId: params.firstParametersNftAssetId,
    secondParametersNftAssetId: params.secondParametersNftAssetId,
    lenderPrincipalCovHash: principalAuthScriptHash,
    lendingParams: params.lendingParams,
  })
  const lendingAddress = await createP2trAddress({
    source: getSource('lending'),
    args: lendingArgs,
    internalKey,
    network,
  })
  const lendingScriptHex = await getScriptPubkeyHexFromAddress(lendingAddress)
  const lendingCovHash = await hashScriptPubkeyHex(lendingScriptHex)

  // 3. ScriptAuth (parameters NFT lock)
  const scriptAuthArgsForParams = buildScriptAuthArguments(lwk, { scriptHash: lendingCovHash })
  const scriptAuthParamsAddress = await createP2trAddress({
    source: getSource('script_auth'),
    args: scriptAuthArgsForParams,
    internalKey,
    network,
  })
  const parametersNftScriptHex = await getScriptPubkeyHexFromAddress(scriptAuthParamsAddress)
  const parametersNftOutputScriptHash = await hashScriptPubkeyHex(parametersNftScriptHex)

  const borrowerOutputScriptHash = await hashScriptPubkeyHex(params.borrowerOutputScriptHex)

  // 4. PreLockArguments and PreLock address
  const preLockArguments = buildPreLockArgumentsObj({
    collateralAssetId: params.collateralAssetId,
    principalAssetId: params.principalAssetId,
    borrowerNftAssetId: params.borrowerNftAssetId,
    lenderNftAssetId: params.lenderNftAssetId,
    firstParametersNftAssetId: params.firstParametersNftAssetId,
    secondParametersNftAssetId: params.secondParametersNftAssetId,
    lendingCovHash,
    parametersNftOutputScriptHash,
    borrowerNftOutputScriptHash: borrowerOutputScriptHash,
    principalOutputScriptHash: borrowerOutputScriptHash,
    borrowerPubKey: params.borrowerPubKey,
    lendingParams: params.lendingParams,
  })
  const preLockArgs = buildPreLockSimplicityArgs(lwk, preLockArguments)
  const preLockAddress = await createP2trAddress({
    source: getSource('pre_lock'),
    args: preLockArgs,
    internalKey,
    network,
  })
  const preLockScriptPubkeyHex = await getScriptPubkeyHexFromAddress(preLockAddress)
  const preLockScriptHash = await hashScriptPubkeyHex(preLockScriptPubkeyHex)

  // 5. ScriptAuth for utility NFTs output (bound to PreLock script hash)
  const scriptAuthUtilityArgs = buildScriptAuthArguments(lwk, { scriptHash: preLockScriptHash })
  const utilityNftsAddress = await createP2trAddress({
    source: getSource('script_auth'),
    args: scriptAuthUtilityArgs,
    internalKey,
    network,
  })
  const utilityNftsOutputScriptHex = await getScriptPubkeyHexFromAddress(utilityNftsAddress)

  return {
    principalAuthScriptHash,
    lendingCovHash,
    parametersNftOutputScriptHash,
    borrowerOutputScriptHash,
    preLockScriptHash,
    preLockAddressScriptPubkey: new Uint8Array(0), // optional, callers use preLockScriptPubkeyHex
    utilityNftsOutputScriptPubkey: new Uint8Array(0),
    preLockScriptPubkeyHex,
    utilityNftsOutputScriptHex,
    lendingScriptPubkeyHex: lendingScriptHex,
    parametersNftScriptPubkeyHex: parametersNftScriptHex,
  }
}

/**
 * Build PreLock arguments (and lending covenant hash) from an offer and its creation tx.
 * Use for both Accept Offer (validate PreLock + get lendingCovHash) and Cancel Offer (spend PreLock).
 */
export async function buildPreLockArgumentsFromOfferCreation(
  offer: OfferShort,
  offerCreationTx: EsploraTx,
  network: P2pkNetwork
): Promise<{
  preLockArguments: PreLockArguments
  lendingCovHash: Uint8Array
  principalAuthScriptHash: Uint8Array
  lendingScriptPubkeyHex: string
  parametersNftScriptPubkeyHex: string
  borrowerScriptPubkeyHex: string
}> {
  const opReturnPrevout = requireVout(offerCreationTx, 5, 'OP_RETURN', 'offer creation tx')
  const { borrowerPubKey, principalAssetId } = parseOpReturn64(
    getScriptHexFromVout(opReturnPrevout)
  )
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

  const firstParamsAssetHex = requireAssetHex(firstParamsPrevout, 'First parameters NFT')
  const secondParamsAssetHex = requireAssetHex(secondParamsPrevout, 'Second parameters NFT')
  const borrowerNftAssetHex = requireAssetHex(borrowerNftPrevout, 'Borrower NFT')
  const lenderNftAssetHex = requireAssetHex(lenderNftPrevout, 'Lender NFT')

  const lendingParams: LendingParams = {
    collateralAmount: offer.collateral_amount,
    principalAmount: offer.principal_amount,
    loanExpirationTime: offer.loan_expiration_time,
    principalInterestRate: offer.interest_rate,
  }

  const collateralAssetId = assetIdDisplayToInternal(offer.collateral_asset)
  const borrowerNftAssetId = assetIdDisplayToInternal(borrowerNftAssetHex)
  const lenderNftAssetId = assetIdDisplayToInternal(lenderNftAssetHex)
  const firstParametersNftAssetId = assetIdDisplayToInternal(firstParamsAssetHex)
  const secondParametersNftAssetId = assetIdDisplayToInternal(secondParamsAssetHex)
  const borrowerCollateralPrevout = requireVinPrevout(
    offerCreationTx,
    0,
    'Borrower collateral input',
    'offer creation tx'
  )
  const borrowerScriptPubkeyHex = getScriptHexFromVout(borrowerCollateralPrevout)

  const hashes = await computePreLockCovenantHashes({
    collateralAssetId,
    principalAssetId,
    borrowerNftAssetId,
    lenderNftAssetId,
    firstParametersNftAssetId,
    secondParametersNftAssetId,
    lendingParams,
    borrowerPubKey,
    borrowerOutputScriptHex: borrowerScriptPubkeyHex,
    network,
  })

  if (offer.borrower_output_script_hash) {
    const expectedHash = normalizeHex(offer.borrower_output_script_hash)
    const actualHash = normalizeHex(bytesToHex(hashes.borrowerOutputScriptHash))
    if (expectedHash && expectedHash !== actualHash) {
      throw new Error('Offer borrower output script hash does not match collateral input prevout.')
    }
  }

  const preLockArguments = buildPreLockArgumentsObj({
    collateralAssetId,
    principalAssetId,
    borrowerNftAssetId,
    lenderNftAssetId,
    firstParametersNftAssetId,
    secondParametersNftAssetId,
    lendingCovHash: hashes.lendingCovHash,
    parametersNftOutputScriptHash: hashes.parametersNftOutputScriptHash,
    borrowerNftOutputScriptHash: hashes.borrowerOutputScriptHash,
    principalOutputScriptHash: hashes.borrowerOutputScriptHash,
    borrowerPubKey,
    lendingParams,
  })

  return {
    preLockArguments,
    lendingCovHash: hashes.lendingCovHash,
    principalAuthScriptHash: hashes.principalAuthScriptHash,
    lendingScriptPubkeyHex: hashes.lendingScriptPubkeyHex,
    parametersNftScriptPubkeyHex: hashes.parametersNftScriptPubkeyHex,
    borrowerScriptPubkeyHex,
  }
}
