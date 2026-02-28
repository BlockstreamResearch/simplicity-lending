/**
 * Build (unsigned) Accept Offer transaction: spend PreLock → create Lending covenant UTXO.
 * Mirrors crates/contracts/src/sdk/pre_lock/lending_creation.rs build_pre_lock_lending_creation().
 *
 * NOTE: This function currently builds the transaction structure only (PSET + unsigned tx hex).
 * Finalizing covenant inputs and signing P2PK inputs is handled separately.
 */

import type { EsploraTx, EsploraVout } from '../../api/esplora'
import { hashScriptPubkeyHex } from '../../api/esplora'
import type { OfferShort } from '../../types/offers'
import type { PreLockArguments } from '../../utility/preLockArguments'
import type { P2pkNetwork, PsetWithExtractTx } from '../../simplicity'
import { createPsetBuilder } from '../psetBuilder'
import { getLwk, getSource, createP2trAddress } from '../../simplicity'
import {
  getScriptHexFromVout,
  hexToBytes32,
  assetIdDisplayToInternal,
  normalizeHex,
} from '../../utility/hex'
import { requireVout, requireAssetHex, requireValue } from '../../utility/esploraPrevout'
import {
  getP2pkAddressFromPublicKey,
  getScriptPubkeyHexFromAddress,
} from '../../utility/addressP2pk'
import {
  buildAssetAuthArguments,
  buildLendingArguments,
  buildScriptAuthArguments,
  buildPreLockArguments as buildPreLockSimplicityArgs,
} from '../../simplicity/covenants'
import { buildPreLockArguments as buildPreLockArgumentsObj } from '../../utility/preLockArguments'
import { getTaprootUnspendableInternalKey } from '../../utility/taprootUnspendableKey'

export interface AcceptOfferUtxo {
  outpoint: { txid: string; vout: number }
  prevout: EsploraVout
}

export interface BuildAcceptOfferTxParams {
  offer: OfferShort
  offerCreationTx: EsploraTx
  principalUtxo: AcceptOfferUtxo
  feeUtxo: AcceptOfferUtxo
  feeAmount: bigint
  network: P2pkNetwork
}

export interface BuildAcceptOfferTxResult {
  /** Unsigned PSET (for later finalization/signing). */
  pset: unknown
  /** Unsigned transaction hex (pset.extractTx().toString()). */
  unsignedTxHex: string
  /** For finalization: PreLock arguments (same as used to validate script). */
  preLockArguments: PreLockArguments
  /** For finalization: Lending covenant script hash (ScriptAuth argument). */
  lendingCovHash: Uint8Array
  /** Prevouts in input order (7): PreLock, FirstParams, SecondParams, BorrowerNFT, LenderNFT, Principal, Fee. */
  prevouts: EsploraVout[]
}

function parseOpReturn64(scriptHex: string): {
  borrowerPubKey: Uint8Array
  principalAssetId: Uint8Array
} {
  const hex = normalizeHex(scriptHex).replace(/\s/g, '')
  if (!hex.startsWith('6a40')) {
    throw new Error('Offer creation OP_RETURN must start with 6a40 (OP_RETURN + push 64)')
  }
  const dataHex = hex.slice(4)
  if (dataHex.length !== 128)
    throw new Error('Offer creation OP_RETURN must contain exactly 64 bytes')
  const data = hexToBytes32(dataHex.slice(0, 64))
  const principal = hexToBytes32(dataHex.slice(64))
  return { borrowerPubKey: data, principalAssetId: principal }
}

export async function buildAcceptOfferTx(
  params: BuildAcceptOfferTxParams
): Promise<BuildAcceptOfferTxResult> {
  const { offer, offerCreationTx, principalUtxo, feeUtxo, feeAmount, network } = params

  if (feeAmount <= 0n) throw new Error('Fee amount must be at least 1')

  // Offer creation tx vouts (by convention used in web builders):
  // 0=PreLock, 1=First params NFT, 2=Second params NFT, 3=Borrower NFT, 4=Lender NFT, 5=OP_RETURN.
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
  const opReturnPrevout = requireVout(offerCreationTx, 5, 'OP_RETURN', 'offer creation tx')

  const preLockAssetHex = requireAssetHex(preLockPrevout, 'PreLock')
  const preLockValue = requireValue(preLockPrevout, 'PreLock')
  const principalAssetHex = requireAssetHex(principalUtxo.prevout, 'Principal')
  const principalValue = requireValue(principalUtxo.prevout, 'Principal')
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

  if (normalizeHex(offer.collateral_asset) !== preLockAssetHex) {
    throw new Error('PreLock asset does not match offer collateral asset')
  }
  if (preLockValue !== offer.collateral_amount) {
    throw new Error('PreLock value does not match offer collateral amount')
  }
  if (normalizeHex(offer.principal_asset) !== principalAssetHex) {
    throw new Error('Principal UTXO asset does not match offer principal asset')
  }
  if (principalValue !== offer.principal_amount) {
    throw new Error('Principal UTXO value does not match offer principal amount')
  }
  if (borrowerNftValue !== 1n || lenderNftValue !== 1n) {
    throw new Error('Borrower and Lender NFT prevouts must have value 1')
  }
  if (feeValue < feeAmount) {
    throw new Error(`Fee UTXO value ${feeValue} is less than fee ${feeAmount}`)
  }

  const { borrowerPubKey, principalAssetId: principalAssetIdFromOpReturn } = parseOpReturn64(
    getScriptHexFromVout(opReturnPrevout)
  )
  const principalInternalFromOffer = assetIdDisplayToInternal(offer.principal_asset)
  for (let i = 0; i < 32; i++) {
    if (principalAssetIdFromOpReturn[i] !== principalInternalFromOffer[i]) {
      throw new Error('OP_RETURN principal asset id does not match offer principal asset id')
    }
  }

  const lendingParams = {
    collateralAmount: offer.collateral_amount,
    principalAmount: offer.principal_amount,
    loanExpirationTime: offer.loan_expiration_time,
    principalInterestRate: offer.interest_rate,
  }

  const lwk = await getLwk()
  const internalKey = getTaprootUnspendableInternalKey(lwk)

  // Asset IDs for covenant arguments are in internal order (byte-reversed vs display).
  const collateralAssetId = assetIdDisplayToInternal(offer.collateral_asset)
  const principalAssetId = principalInternalFromOffer
  const borrowerNftAssetId = assetIdDisplayToInternal(borrowerNftAssetHex)
  const lenderNftAssetId = assetIdDisplayToInternal(lenderNftAssetHex)
  const firstParametersNftAssetId = assetIdDisplayToInternal(firstParamsAssetHex)
  const secondParametersNftAssetId = assetIdDisplayToInternal(secondParamsAssetHex)

  // 1) AssetAuth covenant for lender NFT (principal claim auth), used for hash in lending args.
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
  const principalAuthScriptHex = await getScriptPubkeyHexFromAddress(assetAuthAddress)
  const principalAuthScriptHash = await hashScriptPubkeyHex(principalAuthScriptHex)

  // 2) Lending covenant script.
  const lendingArgs = buildLendingArguments(lwk, {
    collateralAssetId,
    principalAssetId,
    borrowerNftAssetId,
    lenderNftAssetId,
    firstParametersNftAssetId,
    secondParametersNftAssetId,
    lenderPrincipalCovHash: principalAuthScriptHash,
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

  // 3) ScriptAuth (parameters NFTs output script).
  const scriptAuthArgs = buildScriptAuthArguments(lwk, { scriptHash: lendingCovHash })
  const scriptAuthAddress = await createP2trAddress({
    source: getSource('script_auth'),
    args: scriptAuthArgs,
    internalKey,
    network,
  })
  const scriptAuthScriptPubkeyHex = await getScriptPubkeyHexFromAddress(scriptAuthAddress)
  const parametersNftOutputScriptHash = await hashScriptPubkeyHex(scriptAuthScriptPubkeyHex)

  // 4) Borrower P2PK output script.
  const borrowerAddress = await getP2pkAddressFromPublicKey(borrowerPubKey, network)
  const borrowerScriptPubkeyHex = await getScriptPubkeyHexFromAddress(borrowerAddress)
  const borrowerP2trScriptHash = await hashScriptPubkeyHex(borrowerScriptPubkeyHex)

  // 5) Validate that the PreLock prevout is spendable by the expected PreLock covenant script.
  const preLockArguments = buildPreLockArgumentsObj({
    collateralAssetId,
    principalAssetId,
    borrowerNftAssetId,
    lenderNftAssetId,
    firstParametersNftAssetId,
    secondParametersNftAssetId,
    lendingCovHash,
    parametersNftOutputScriptHash,
    borrowerNftOutputScriptHash: borrowerP2trScriptHash,
    principalOutputScriptHash: borrowerP2trScriptHash,
    borrowerPubKey,
    lendingParams,
  })

  const preLockSimplicityArgs = buildPreLockSimplicityArgs(lwk, preLockArguments)
  const preLockAddress = await createP2trAddress({
    source: getSource('pre_lock'),
    args: preLockSimplicityArgs,
    internalKey,
    network,
  })
  const expectedPreLockScriptHex = await getScriptPubkeyHexFromAddress(preLockAddress)
  const actualPreLockScriptHex = getScriptHexFromVout(preLockPrevout)
  if (normalizeHex(actualPreLockScriptHex) !== normalizeHex(expectedPreLockScriptHex)) {
    throw new Error('PreLock prevout script does not match expected PreLock covenant script')
  }

  // Lender NFT output script: send back to the fee UTXO script (same wallet/account).
  const lenderNftOutputScriptHex = getScriptHexFromVout(feeUtxo.prevout)

  const networkKey: 'mainnet' | 'testnet' = network === 'mainnet' ? 'mainnet' : 'testnet'
  const api = await createPsetBuilder(networkKey)
  const policyAssetHex = api.getPolicyAssetHex()
  if (normalizeHex(policyAssetHex) !== normalizeHex(feeAssetHex)) {
    throw new Error('Fee UTXO must be policy asset (LBTC)')
  }

  // Inputs in the same order as Rust builder.
  const txid = offerCreationTx.txid.trim()
  api.addInput({ txid, vout: 0 }, preLockPrevout)
  api.addInput({ txid, vout: 1 }, firstParamsPrevout)
  api.addInput({ txid, vout: 2 }, secondParamsPrevout)
  api.addInput({ txid, vout: 3 }, borrowerNftPrevout)
  api.addInput({ txid, vout: 4 }, lenderNftPrevout)
  api.addInput(principalUtxo.outpoint, principalUtxo.prevout)
  api.addInput(feeUtxo.outpoint, feeUtxo.prevout)

  // Outputs (same order as Rust builder).
  api.addOutputWithScript(lendingScriptPubkeyHex, preLockValue, preLockAssetHex)
  api.addOutputWithScript(borrowerScriptPubkeyHex, principalValue, principalAssetHex)
  api.addOutputWithScript(scriptAuthScriptPubkeyHex, firstParamsValue, firstParamsAssetHex)
  api.addOutputWithScript(scriptAuthScriptPubkeyHex, secondParamsValue, secondParamsAssetHex)
  api.addOutputWithScript(borrowerScriptPubkeyHex, borrowerNftValue, borrowerNftAssetHex)
  api.addOutputWithScript(lenderNftOutputScriptHex, lenderNftValue, lenderNftAssetHex)

  const feeChange = feeValue - feeAmount
  if (feeChange > 0n) {
    api.addOutputWithScript(getScriptHexFromVout(feeUtxo.prevout), feeChange, policyAssetHex)
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
    principalUtxo.prevout,
    feeUtxo.prevout,
  ]

  return { pset, unsignedTxHex, preLockArguments, lendingCovHash, prevouts }
}
