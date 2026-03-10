import {
  createExplicitBlinder,
  createFinalizerLock,
  createNewIssuanceAsset,
  createOutput,
  createProvidedInput,
  createRuntimeParams,
  createScriptLock,
  createTxCreateRequest,
  createWalletInput,
  createExplicitAsset,
} from 'wallet-abi-sdk-alpha'
import type {
  InputSchema,
  InputUnblinding,
  LockVariant,
  OutputSchema,
  TxCreateRequest,
  WalletAbiNetwork,
} from 'wallet-abi-sdk-alpha/schema'
import type { EsploraTx, EsploraVout } from '../api/esplora'
import type { OfferParticipant, OfferShort, OfferWithParticipants } from '../types/offers'
import {
  buildBorrowerOutputScriptMetadataScript,
  buildOfferMetadataScript,
  assetIdDisplayToInternal,
  bytesToHex,
  getScriptHexFromVout,
  hexToBytes32,
  normalizeHex,
  parseOfferMetadataOutputs,
} from '../utility/hex'
import {
  buildLendingParamsFromParameterNFTs,
  encodeFirstNFTParameters,
  encodeSecondNFTParameters,
  toBaseAmount,
} from '../utility/parametersEncoding'
import { calculatePrincipalWithInterest } from '../utility/principalWithInterest'
import { buildPreLockArguments } from '../utility/preLockArguments'
import {
  OP_RETURN_BURN_SCRIPT_HEX,
  requireAssetHex,
  requireValue,
  requireVout,
} from '../utility/esploraPrevout'
import { POLICY_ASSET_ID, walletAbiNetworkToP2pkNetwork } from '../utility/addressP2pk'
import { computePreLockCovenantHashes } from '../utility/preLockCovenants'
import {
  buildAssetAuthFinalizer,
  buildLendingFinalizer,
  buildPreLockCancellationFinalizer,
  buildPreLockCreationFinalizer,
  buildScriptAuthFinalizer,
} from './finalizers'

const TOKENS_DECIMALS = 0
const ZERO_ASSET_ID = '00'.repeat(32)
const UTILITY_ISSUANCE_INPUT_VALUE = 100
const UTILITY_ISSUANCE_ENTROPY = Array.from({ length: 32 }, () => 7)
const FINAL_SEQUENCE = 0xffff_ffff
const ENABLE_LOCKTIME_NO_RBF_SEQUENCE = 0xffff_fffe

export interface ProtocolTerms {
  collateralAmount: bigint
  principalAmount: bigint
  loanExpirationTime: number
  principalInterestRate: number
}

export interface IssuedUtilityNfts {
  borrowerNftAssetId: string
  lenderNftAssetId: string
  firstParametersNftAssetId: string
  secondParametersNftAssetId: string
  firstParametersAmount: bigint
  secondParametersAmount: bigint
  terms: ProtocolTerms
}

interface FeeRateParams {
  feeRateSatKvb: number
}

export interface BuildPrepareUtilityNftsRequestParams extends FeeRateParams {
  network: WalletAbiNetwork
  destinationScriptPubkeyHex: string
}

export interface BuildIssueUtilityNftsRequestParams extends FeeRateParams {
  network: WalletAbiNetwork
  destinationScriptPubkeyHex: string
  prepareTxid: string
  terms: ProtocolTerms
  prepareInputUnblindings?: InputUnblinding[]
}

export interface BuildCreateOfferRequestParams extends FeeRateParams {
  network: WalletAbiNetwork
  signerScriptPubkeyHex: string
  signingXOnlyPubkey: string
  issuanceTx: EsploraTx
  collateralAssetId: string
  principalAssetId: string
  borrowerDestinationScriptPubkeyHex?: string
}

export interface BuildCancelOfferRequestParams extends FeeRateParams {
  network: WalletAbiNetwork
  signingXOnlyPubkey: string
  offer: OfferShort
  offerCreationTx: EsploraTx
  borrowerOutputScriptPubkeyHex?: string
  collateralDestinationScriptPubkeyHex: string
}

export interface BuildAcceptOfferRequestParams extends FeeRateParams {
  network: WalletAbiNetwork
  signerScriptPubkeyHex: string
  offer: OfferShort
  offerCreationTx: EsploraTx
  borrowerOutputScriptPubkeyHex?: string
  lenderDestinationScriptPubkeyHex?: string
}

export interface BuildRepayLoanRequestParams extends FeeRateParams {
  network: WalletAbiNetwork
  signerScriptPubkeyHex: string
  offer: OfferShort
  offerCreationTx: EsploraTx
  lendingTx: EsploraTx
  borrowerParticipant: OfferParticipant
  collateralDestinationScriptPubkeyHex?: string
}

export interface BuildClaimRepaidPrincipalRequestParams extends FeeRateParams {
  network: WalletAbiNetwork
  signerScriptPubkeyHex: string
  offer: OfferShort
  offerCreationTx: EsploraTx
  repaymentTxid: string
  repaymentVout: number
  lenderParticipant: OfferParticipant
  principalDestinationScriptPubkeyHex?: string
}

export interface BuildLiquidateLoanRequestParams extends FeeRateParams {
  network: WalletAbiNetwork
  signerScriptPubkeyHex: string
  offer: OfferShort
  offerCreationTx: EsploraTx
  lendingTx: EsploraTx
  lenderParticipant: OfferParticipant
  collateralDestinationScriptPubkeyHex?: string
}

interface OfferProtocolArtifacts {
  collateralAssetId: string
  principalAssetId: string
  borrowerNftAssetId: string
  lenderNftAssetId: string
  firstParametersNftAssetId: string
  secondParametersNftAssetId: string
  firstParametersAmount: bigint
  secondParametersAmount: bigint
  terms: ProtocolTerms
  preLockScriptHash: Uint8Array
  lendingCovHash: Uint8Array
  principalAuthScriptHash: Uint8Array
  borrowerOutputScriptPubkeyHex?: string
  preLockArguments: ReturnType<typeof buildPreLockArguments>
}

function toAmountSat(value: bigint, label: string): number {
  const amount = Number(value)
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new Error(`${label} must fit a safe non-negative integer`)
  }
  return amount
}

function normalizeAssetId(assetId: string, label: string): string {
  const normalized = normalizeHex(assetId)
  if (normalized.length !== 64) {
    throw new Error(`${label} must be 64 hex characters`)
  }
  return normalized
}

function normalizeScriptHex(scriptHex: string, label: string): string {
  const normalized = normalizeHex(scriptHex)
  if (normalized.length === 0 || normalized.length % 2 !== 0) {
    throw new Error(`${label} must be non-empty hex`)
  }
  return normalized
}

function normalizeFeeRateSatKvb(feeRateSatKvb: number): number {
  if (!Number.isFinite(feeRateSatKvb) || feeRateSatKvb <= 0) {
    throw new Error('Fee rate must be a positive finite number')
  }
  return feeRateSatKvb
}

function toOutpoint(txid: string, vout: number): string {
  const normalizedTxid = txid.trim()
  if (!normalizedTxid || !Number.isInteger(vout) || vout < 0) {
    throw new Error('Invalid outpoint')
  }
  return `${normalizedTxid}:${vout}`
}

function getPolicyAssetId(network: WalletAbiNetwork): string {
  return POLICY_ASSET_ID[walletAbiNetworkToP2pkNetwork(network)]
}

function isExplicitPreparePrevout(
  vout: EsploraVout
): vout is EsploraVout & { value: number; asset: string } {
  return (
    typeof vout.value === 'number' && Number.isFinite(vout.value) && typeof vout.asset === 'string'
  )
}

function isConfidentialPreparePrevout(vout: EsploraVout): boolean {
  return (
    (typeof vout.valuecommitment === 'string' && vout.valuecommitment.trim().length > 0) ||
    (typeof vout.assetcommitment === 'string' && vout.assetcommitment.trim().length > 0) ||
    (typeof vout.nonce === 'string' && vout.nonce.trim().length > 0) ||
    (typeof vout.noncecommitment === 'string' && vout.noncecommitment.trim().length > 0)
  )
}

function createExplicitOutput(input: {
  id: string
  amount_sat: number
  lock: LockVariant
  assetId: string
}): OutputSchema {
  return createOutput({
    id: input.id,
    amount_sat: input.amount_sat,
    lock: input.lock,
    asset: createExplicitAsset(input.assetId),
    blinder: createExplicitBlinder(),
  })
}

function createBurnOutput(id: string, amount: bigint, assetId: string): OutputSchema {
  return createExplicitOutput({
    id,
    amount_sat: toAmountSat(amount, id),
    lock: createScriptLock(OP_RETURN_BURN_SCRIPT_HEX),
    assetId,
  })
}

function createWalletAssetInput(id: string, assetId: string, minAmountSat?: bigint): InputSchema {
  return createWalletInput({
    id,
    filter: {
      asset: {
        exact: {
          asset_id: normalizeAssetId(assetId, `${id} asset`),
        },
      },
      ...(minAmountSat !== undefined
        ? {
            amount: {
              min: {
                amount_sat: toAmountSat(minAmountSat, `${id} amount`),
              },
            },
          }
        : {}),
    },
  })
}

function buildRequest(
  network: WalletAbiNetwork,
  inputs: InputSchema[],
  outputs: OutputSchema[],
  feeRateSatKvb: number,
  lockTimeBlocks?: number
): TxCreateRequest {
  return createTxCreateRequest({
    network,
    broadcast: true,
    params: createRuntimeParams({
      inputs,
      outputs,
      fee_rate_sat_kvb: normalizeFeeRateSatKvb(feeRateSatKvb),
      ...(lockTimeBlocks !== undefined ? { lock_time: { Blocks: lockTimeBlocks } } : {}),
    }),
  })
}

function enableAbsoluteLocktime(inputs: InputSchema[]): InputSchema[] {
  return inputs.map((input) => ({
    ...input,
    sequence: input.sequence === FINAL_SEQUENCE ? ENABLE_LOCKTIME_NO_RBF_SEQUENCE : input.sequence,
  }))
}

function encodeIssueTerms(terms: ProtocolTerms): {
  firstParametersAmount: bigint
  secondParametersAmount: bigint
} {
  return {
    firstParametersAmount: encodeFirstNFTParameters(
      terms.principalInterestRate,
      terms.loanExpirationTime,
      TOKENS_DECIMALS,
      TOKENS_DECIMALS
    ),
    secondParametersAmount: encodeSecondNFTParameters(
      toBaseAmount(terms.collateralAmount, TOKENS_DECIMALS),
      toBaseAmount(terms.principalAmount, TOKENS_DECIMALS)
    ),
  }
}

function decodeIssuedUtilityNftsFromIssuance(issuanceTx: EsploraTx): IssuedUtilityNfts {
  const borrowerNft = requireVout(issuanceTx, 0, 'Borrower NFT', 'issuance tx')
  const lenderNft = requireVout(issuanceTx, 1, 'Lender NFT', 'issuance tx')
  const firstParameters = requireVout(issuanceTx, 2, 'First parameters NFT', 'issuance tx')
  const secondParameters = requireVout(issuanceTx, 3, 'Second parameters NFT', 'issuance tx')
  const firstParametersAmount = requireValue(firstParameters, 'First parameters NFT')
  const secondParametersAmount = requireValue(secondParameters, 'Second parameters NFT')

  return {
    borrowerNftAssetId: requireAssetHex(borrowerNft, 'Borrower NFT'),
    lenderNftAssetId: requireAssetHex(lenderNft, 'Lender NFT'),
    firstParametersNftAssetId: requireAssetHex(firstParameters, 'First parameters NFT'),
    secondParametersNftAssetId: requireAssetHex(secondParameters, 'Second parameters NFT'),
    firstParametersAmount,
    secondParametersAmount,
    terms: buildLendingParamsFromParameterNFTs(firstParametersAmount, secondParametersAmount),
  }
}

async function resolveOfferProtocolArtifacts(params: {
  network: WalletAbiNetwork
  offer: OfferShort
  offerCreationTx: EsploraTx
  borrowerOutputScriptPubkeyHex?: string
}): Promise<OfferProtocolArtifacts> {
  const firstParameters = requireVout(
    params.offerCreationTx,
    1,
    'First parameters NFT',
    'offer creation tx'
  )
  const secondParameters = requireVout(
    params.offerCreationTx,
    2,
    'Second parameters NFT',
    'offer creation tx'
  )
  const borrowerNft = requireVout(params.offerCreationTx, 3, 'Borrower NFT', 'offer creation tx')
  const lenderNft = requireVout(params.offerCreationTx, 4, 'Lender NFT', 'offer creation tx')
  const metadata = requireVout(params.offerCreationTx, 5, 'Metadata', 'offer creation tx')
  const borrowerOutputMetadata = params.offerCreationTx.vout.at(6)
  const borrowerOutputMetadataScriptHex = borrowerOutputMetadata
    ? getScriptHexFromVout(borrowerOutputMetadata)
    : undefined
  const {
    borrowerPubKey,
    principalAssetId: metadataPrincipalAssetId,
    borrowerOutputScriptHash,
    borrowerOutputScriptPubkeyHex: borrowerOutputScriptPubkeyHexFromMetadata,
  } = parseOfferMetadataOutputs(
    getScriptHexFromVout(metadata),
    borrowerOutputMetadataScriptHex &&
      normalizeHex(borrowerOutputMetadataScriptHex).startsWith('6a')
      ? borrowerOutputMetadataScriptHex
      : undefined
  )
  const principalAssetId = normalizeAssetId(params.offer.principal_asset, 'Offer principal asset')
  const principalAssetInternal = assetIdDisplayToInternal(principalAssetId)
  if (bytesToHex(metadataPrincipalAssetId) !== bytesToHex(principalAssetInternal)) {
    throw new Error('Offer metadata principal asset id does not match offer principal asset')
  }

  const collateralAssetId = normalizeAssetId(
    params.offer.collateral_asset,
    'Offer collateral asset'
  )
  const borrowerNftAssetId = requireAssetHex(borrowerNft, 'Borrower NFT')
  const lenderNftAssetId = requireAssetHex(lenderNft, 'Lender NFT')
  const firstParametersNftAssetId = requireAssetHex(firstParameters, 'First parameters NFT')
  const secondParametersNftAssetId = requireAssetHex(secondParameters, 'Second parameters NFT')
  const firstParametersAmount = requireValue(firstParameters, 'First parameters NFT')
  const secondParametersAmount = requireValue(secondParameters, 'Second parameters NFT')
  const terms: ProtocolTerms = {
    collateralAmount: params.offer.collateral_amount,
    principalAmount: params.offer.principal_amount,
    loanExpirationTime: params.offer.loan_expiration_time,
    principalInterestRate: params.offer.interest_rate,
  }

  const hashes = await computePreLockCovenantHashes({
    collateralAssetId: assetIdDisplayToInternal(collateralAssetId),
    principalAssetId: principalAssetInternal,
    borrowerNftAssetId: assetIdDisplayToInternal(borrowerNftAssetId),
    lenderNftAssetId: assetIdDisplayToInternal(lenderNftAssetId),
    firstParametersNftAssetId: assetIdDisplayToInternal(firstParametersNftAssetId),
    secondParametersNftAssetId: assetIdDisplayToInternal(secondParametersNftAssetId),
    lendingParams: terms,
    borrowerPubKey,
    borrowerOutputScriptPubkeyHex:
      params.borrowerOutputScriptPubkeyHex ?? borrowerOutputScriptPubkeyHexFromMetadata,
    borrowerOutputScriptHash,
    network: walletAbiNetworkToP2pkNetwork(params.network),
  })

  const preLockArguments = buildPreLockArguments({
    collateralAssetId: assetIdDisplayToInternal(collateralAssetId),
    principalAssetId: principalAssetInternal,
    borrowerNftAssetId: assetIdDisplayToInternal(borrowerNftAssetId),
    lenderNftAssetId: assetIdDisplayToInternal(lenderNftAssetId),
    firstParametersNftAssetId: assetIdDisplayToInternal(firstParametersNftAssetId),
    secondParametersNftAssetId: assetIdDisplayToInternal(secondParametersNftAssetId),
    lendingCovHash: hashes.lendingCovHash,
    parametersNftOutputScriptHash: hashes.parametersNftOutputScriptHash,
    borrowerNftOutputScriptHash: hashes.borrowerOutputScriptHash,
    principalOutputScriptHash: hashes.borrowerOutputScriptHash,
    borrowerPubKey,
    lendingParams: terms,
  })

  return {
    collateralAssetId,
    principalAssetId,
    borrowerNftAssetId,
    lenderNftAssetId,
    firstParametersNftAssetId,
    secondParametersNftAssetId,
    firstParametersAmount,
    secondParametersAmount,
    terms,
    preLockScriptHash: hashes.preLockScriptHash,
    lendingCovHash: hashes.lendingCovHash,
    principalAuthScriptHash: hashes.principalAuthScriptHash,
    borrowerOutputScriptPubkeyHex: hashes.borrowerScriptPubkeyHex,
    preLockArguments,
  }
}

export function decodeIssuedUtilityNfts(issuanceTx: EsploraTx): IssuedUtilityNfts {
  return decodeIssuedUtilityNftsFromIssuance(issuanceTx)
}

export function getBorrowerScriptPubkeyFromOffer(offer: OfferWithParticipants): string {
  const borrower = offer.participants.find(
    (participant) => participant.participant_type === 'borrower'
  )
  if (!borrower?.script_pubkey) {
    throw new Error('Offer is missing borrower participant script_pubkey')
  }
  return normalizeScriptHex(borrower.script_pubkey, 'Borrower script_pubkey')
}

export function buildPrepareUtilityNftsRequest(
  params: BuildPrepareUtilityNftsRequestParams
): TxCreateRequest {
  const destinationScript = normalizeScriptHex(
    params.destinationScriptPubkeyHex,
    'Prepare destination script'
  )
  const policyAssetId = getPolicyAssetId(params.network)
  const outputs = Array.from({ length: 4 }, (_, index) =>
    createExplicitOutput({
      id: `issuance-utxo-${index}`,
      amount_sat: UTILITY_ISSUANCE_INPUT_VALUE,
      lock: createScriptLock(destinationScript),
      assetId: policyAssetId,
    })
  )
  return buildRequest(params.network, [], outputs, params.feeRateSatKvb)
}

export function resolvePrepareUtilityNftsInputUnblindings(params: {
  network: WalletAbiNetwork
  prepareTx: EsploraTx
}): InputUnblinding[] {
  const policyAssetId = getPolicyAssetId(params.network)

  return Array.from({ length: 4 }, (_, index) => {
    const output = requireVout(
      params.prepareTx,
      index,
      `Prepare output ${String(index)}`,
      'prepare tx'
    )

    if (isExplicitPreparePrevout(output)) {
      if (output.value !== UTILITY_ISSUANCE_INPUT_VALUE) {
        throw new Error(
          `Prepare tx output ${String(index)} must be ${String(UTILITY_ISSUANCE_INPUT_VALUE)} sats, got ${String(output.value)}`
        )
      }

      if (
        normalizeAssetId(output.asset, `Prepare tx output ${String(index)} asset`) !== policyAssetId
      ) {
        throw new Error(`Prepare tx output ${String(index)} is not funded with the policy asset`)
      }

      return 'explicit'
    }

    if (isConfidentialPreparePrevout(output)) {
      return 'wallet'
    }

    throw new Error(`Prepare tx output ${String(index)} is neither explicit nor confidential`)
  })
}

export function buildIssueUtilityNftsRequest(
  params: BuildIssueUtilityNftsRequestParams
): TxCreateRequest {
  const destinationScript = normalizeScriptHex(
    params.destinationScriptPubkeyHex,
    'Issue destination script'
  )
  const policyAssetId = getPolicyAssetId(params.network)
  const prepareInputUnblindings = Array.from(
    { length: 4 },
    (_, index) => params.prepareInputUnblindings?.[index] ?? 'explicit'
  )
  const { firstParametersAmount, secondParametersAmount } = encodeIssueTerms(params.terms)
  const inputs: InputSchema[] = [
    createProvidedInput({
      id: 'borrower-issuance',
      outpoint: toOutpoint(params.prepareTxid, 0),
      unblinding: prepareInputUnblindings[0],
      issuance: {
        kind: 'new',
        asset_amount_sat: 1,
        token_amount_sat: 0,
        entropy: UTILITY_ISSUANCE_ENTROPY,
      },
    }),
    createProvidedInput({
      id: 'lender-issuance',
      outpoint: toOutpoint(params.prepareTxid, 1),
      unblinding: prepareInputUnblindings[1],
      issuance: {
        kind: 'new',
        asset_amount_sat: 1,
        token_amount_sat: 0,
        entropy: UTILITY_ISSUANCE_ENTROPY,
      },
    }),
    createProvidedInput({
      id: 'first-parameters-issuance',
      outpoint: toOutpoint(params.prepareTxid, 2),
      unblinding: prepareInputUnblindings[2],
      issuance: {
        kind: 'new',
        asset_amount_sat: toAmountSat(firstParametersAmount, 'First parameters amount'),
        token_amount_sat: 0,
        entropy: UTILITY_ISSUANCE_ENTROPY,
      },
    }),
    createProvidedInput({
      id: 'second-parameters-issuance',
      outpoint: toOutpoint(params.prepareTxid, 3),
      unblinding: prepareInputUnblindings[3],
      issuance: {
        kind: 'new',
        asset_amount_sat: toAmountSat(secondParametersAmount, 'Second parameters amount'),
        token_amount_sat: 0,
        entropy: UTILITY_ISSUANCE_ENTROPY,
      },
    }),
    createWalletAssetInput('issue-fee', policyAssetId),
  ]
  const outputs: OutputSchema[] = [
    createOutput({
      id: 'borrower-nft',
      amount_sat: 1,
      lock: createScriptLock(destinationScript),
      asset: createNewIssuanceAsset(0),
      blinder: createExplicitBlinder(),
    }),
    createOutput({
      id: 'lender-nft',
      amount_sat: 1,
      lock: createScriptLock(destinationScript),
      asset: createNewIssuanceAsset(1),
      blinder: createExplicitBlinder(),
    }),
    createOutput({
      id: 'first-parameters-nft',
      amount_sat: toAmountSat(firstParametersAmount, 'First parameters amount'),
      lock: createScriptLock(destinationScript),
      asset: createNewIssuanceAsset(2),
      blinder: createExplicitBlinder(),
    }),
    createOutput({
      id: 'second-parameters-nft',
      amount_sat: toAmountSat(secondParametersAmount, 'Second parameters amount'),
      lock: createScriptLock(destinationScript),
      asset: createNewIssuanceAsset(3),
      blinder: createExplicitBlinder(),
    }),
    ...Array.from({ length: 4 }, (_, index) =>
      createExplicitOutput({
        id: `return-issuance-${index}`,
        amount_sat: UTILITY_ISSUANCE_INPUT_VALUE,
        lock: createScriptLock(destinationScript),
        assetId: policyAssetId,
      })
    ),
  ]
  return buildRequest(params.network, inputs, outputs, params.feeRateSatKvb)
}

export async function buildCreateOfferRequest(
  params: BuildCreateOfferRequestParams
): Promise<TxCreateRequest> {
  const policyAssetId = getPolicyAssetId(params.network)
  const issued = decodeIssuedUtilityNftsFromIssuance(params.issuanceTx)
  const borrowerDestinationScript = normalizeScriptHex(
    params.borrowerDestinationScriptPubkeyHex ?? params.signerScriptPubkeyHex,
    'Borrower destination script'
  )
  const collateralAssetId = normalizeAssetId(params.collateralAssetId, 'Collateral asset')
  const principalAssetId = normalizeAssetId(params.principalAssetId, 'Principal asset')
  const borrowerPubKey = hexToBytes32(params.signingXOnlyPubkey)
  const covenantHashes = await computePreLockCovenantHashes({
    collateralAssetId: assetIdDisplayToInternal(collateralAssetId),
    principalAssetId: assetIdDisplayToInternal(principalAssetId),
    borrowerNftAssetId: assetIdDisplayToInternal(issued.borrowerNftAssetId),
    lenderNftAssetId: assetIdDisplayToInternal(issued.lenderNftAssetId),
    firstParametersNftAssetId: assetIdDisplayToInternal(issued.firstParametersNftAssetId),
    secondParametersNftAssetId: assetIdDisplayToInternal(issued.secondParametersNftAssetId),
    lendingParams: issued.terms,
    borrowerPubKey,
    borrowerOutputScriptPubkeyHex: borrowerDestinationScript,
    network: walletAbiNetworkToP2pkNetwork(params.network),
  })
  const preLockArguments = buildPreLockArguments({
    collateralAssetId: assetIdDisplayToInternal(collateralAssetId),
    principalAssetId: assetIdDisplayToInternal(principalAssetId),
    borrowerNftAssetId: assetIdDisplayToInternal(issued.borrowerNftAssetId),
    lenderNftAssetId: assetIdDisplayToInternal(issued.lenderNftAssetId),
    firstParametersNftAssetId: assetIdDisplayToInternal(issued.firstParametersNftAssetId),
    secondParametersNftAssetId: assetIdDisplayToInternal(issued.secondParametersNftAssetId),
    lendingCovHash: covenantHashes.lendingCovHash,
    parametersNftOutputScriptHash: covenantHashes.parametersNftOutputScriptHash,
    borrowerNftOutputScriptHash: covenantHashes.borrowerOutputScriptHash,
    principalOutputScriptHash: covenantHashes.borrowerOutputScriptHash,
    borrowerPubKey,
    lendingParams: issued.terms,
  })
  const [preLockFinalizer, utilityScriptAuthFinalizer] = await Promise.all([
    buildPreLockCreationFinalizer(preLockArguments),
    buildScriptAuthFinalizer(covenantHashes.preLockScriptHash),
  ])
  const inputs: InputSchema[] = [
    createWalletAssetInput('collateral', collateralAssetId, issued.terms.collateralAmount),
    createProvidedInput({
      id: 'first-parameters',
      outpoint: toOutpoint(params.issuanceTx.txid, 2),
    }),
    createProvidedInput({
      id: 'second-parameters',
      outpoint: toOutpoint(params.issuanceTx.txid, 3),
    }),
    createProvidedInput({
      id: 'borrower-nft',
      outpoint: toOutpoint(params.issuanceTx.txid, 0),
    }),
    createProvidedInput({
      id: 'lender-nft',
      outpoint: toOutpoint(params.issuanceTx.txid, 1),
    }),
    ...(collateralAssetId !== policyAssetId
      ? [createWalletAssetInput('pre-lock-fee', policyAssetId)]
      : []),
  ]
  const outputs: OutputSchema[] = [
    createExplicitOutput({
      id: 'pre-lock',
      amount_sat: toAmountSat(issued.terms.collateralAmount, 'Collateral amount'),
      lock: createFinalizerLock(preLockFinalizer),
      assetId: collateralAssetId,
    }),
    createExplicitOutput({
      id: 'first-parameters-script-auth',
      amount_sat: toAmountSat(issued.firstParametersAmount, 'First parameters amount'),
      lock: createFinalizerLock(utilityScriptAuthFinalizer),
      assetId: issued.firstParametersNftAssetId,
    }),
    createExplicitOutput({
      id: 'second-parameters-script-auth',
      amount_sat: toAmountSat(issued.secondParametersAmount, 'Second parameters amount'),
      lock: createFinalizerLock(utilityScriptAuthFinalizer),
      assetId: issued.secondParametersNftAssetId,
    }),
    createExplicitOutput({
      id: 'borrower-script-auth',
      amount_sat: 1,
      lock: createFinalizerLock(utilityScriptAuthFinalizer),
      assetId: issued.borrowerNftAssetId,
    }),
    createExplicitOutput({
      id: 'lender-script-auth',
      amount_sat: 1,
      lock: createFinalizerLock(utilityScriptAuthFinalizer),
      assetId: issued.lenderNftAssetId,
    }),
    createExplicitOutput({
      id: 'pre-lock-metadata',
      amount_sat: 0,
      lock: createScriptLock(buildOfferMetadataScript(params.signingXOnlyPubkey, principalAssetId)),
      assetId: ZERO_ASSET_ID,
    }),
    createExplicitOutput({
      id: 'pre-lock-borrower-output-script-hash',
      amount_sat: 0,
      lock: createScriptLock(buildBorrowerOutputScriptMetadataScript(borrowerDestinationScript)),
      assetId: ZERO_ASSET_ID,
    }),
  ]
  return buildRequest(params.network, inputs, outputs, params.feeRateSatKvb)
}

export async function buildCancelOfferRequest(
  params: BuildCancelOfferRequestParams
): Promise<TxCreateRequest> {
  const artifacts = await resolveOfferProtocolArtifacts({
    network: params.network,
    offer: params.offer,
    offerCreationTx: params.offerCreationTx,
    borrowerOutputScriptPubkeyHex: params.borrowerOutputScriptPubkeyHex,
  })
  const policyAssetId = getPolicyAssetId(params.network)
  const [preLockCancellationFinalizer, utilityScriptAuthFinalizer] = await Promise.all([
    buildPreLockCancellationFinalizer({
      arguments: artifacts.preLockArguments,
      signingXOnlyPubkey: normalizeHex(params.signingXOnlyPubkey),
    }),
    buildScriptAuthFinalizer(artifacts.preLockScriptHash),
  ])
  const outputs: OutputSchema[] = [
    createExplicitOutput({
      id: 'collateral-return',
      amount_sat: toAmountSat(params.offer.collateral_amount, 'Collateral amount'),
      lock: createScriptLock(
        normalizeScriptHex(params.collateralDestinationScriptPubkeyHex, 'Collateral destination')
      ),
      assetId: artifacts.collateralAssetId,
    }),
    createBurnOutput(
      'first-parameters-burn',
      artifacts.firstParametersAmount,
      artifacts.firstParametersNftAssetId
    ),
    createBurnOutput(
      'second-parameters-burn',
      artifacts.secondParametersAmount,
      artifacts.secondParametersNftAssetId
    ),
    createBurnOutput('borrower-burn', 1n, artifacts.borrowerNftAssetId),
    createBurnOutput('lender-burn', 1n, artifacts.lenderNftAssetId),
  ]
  const inputs: InputSchema[] = [
    createProvidedInput({
      id: 'pre-lock',
      outpoint: toOutpoint(params.offerCreationTx.txid, 0),
      finalizer: preLockCancellationFinalizer,
    }),
    createProvidedInput({
      id: 'first-parameters-script-auth',
      outpoint: toOutpoint(params.offerCreationTx.txid, 1),
      finalizer: utilityScriptAuthFinalizer,
    }),
    createProvidedInput({
      id: 'second-parameters-script-auth',
      outpoint: toOutpoint(params.offerCreationTx.txid, 2),
      finalizer: utilityScriptAuthFinalizer,
    }),
    createProvidedInput({
      id: 'borrower-script-auth',
      outpoint: toOutpoint(params.offerCreationTx.txid, 3),
      finalizer: utilityScriptAuthFinalizer,
    }),
    createProvidedInput({
      id: 'lender-script-auth',
      outpoint: toOutpoint(params.offerCreationTx.txid, 4),
      finalizer: utilityScriptAuthFinalizer,
    }),
    createWalletAssetInput('cancel-fee', policyAssetId),
  ]
  return buildRequest(params.network, inputs, outputs, params.feeRateSatKvb)
}

export async function buildAcceptOfferRequest(
  params: BuildAcceptOfferRequestParams
): Promise<TxCreateRequest> {
  const artifacts = await resolveOfferProtocolArtifacts({
    network: params.network,
    offer: params.offer,
    offerCreationTx: params.offerCreationTx,
    borrowerOutputScriptPubkeyHex: params.borrowerOutputScriptPubkeyHex,
  })
  const policyAssetId = getPolicyAssetId(params.network)
  const borrowerOutputScriptSource =
    artifacts.borrowerOutputScriptPubkeyHex ?? params.borrowerOutputScriptPubkeyHex
  if (!borrowerOutputScriptSource) {
    throw new Error(
      'Offer stores only the borrower output script hash. Enter the borrower destination address to accept it.'
    )
  }
  const borrowerOutputScript = normalizeScriptHex(
    borrowerOutputScriptSource,
    'Borrower output script'
  )
  const lenderDestinationScript = normalizeScriptHex(
    params.lenderDestinationScriptPubkeyHex ?? params.signerScriptPubkeyHex,
    'Lender destination script'
  )
  const [
    preLockCreationFinalizer,
    utilityScriptAuthFinalizer,
    lendingFinalizer,
    parametersOutputFinalizer,
  ] = await Promise.all([
    buildPreLockCreationFinalizer(artifacts.preLockArguments),
    buildScriptAuthFinalizer(artifacts.preLockScriptHash),
    buildLendingFinalizer({
      collateralAssetId: assetIdDisplayToInternal(artifacts.collateralAssetId),
      principalAssetId: assetIdDisplayToInternal(artifacts.principalAssetId),
      borrowerNftAssetId: assetIdDisplayToInternal(artifacts.borrowerNftAssetId),
      lenderNftAssetId: assetIdDisplayToInternal(artifacts.lenderNftAssetId),
      firstParametersNftAssetId: assetIdDisplayToInternal(artifacts.firstParametersNftAssetId),
      secondParametersNftAssetId: assetIdDisplayToInternal(artifacts.secondParametersNftAssetId),
      lenderPrincipalCovHash: artifacts.principalAuthScriptHash,
      lendingParams: artifacts.terms,
      branch: 'LoanRepayment',
    }),
    buildScriptAuthFinalizer(artifacts.lendingCovHash),
  ])
  const inputs: InputSchema[] = [
    createProvidedInput({
      id: 'pre-lock',
      outpoint: toOutpoint(params.offerCreationTx.txid, 0),
      finalizer: preLockCreationFinalizer,
    }),
    createProvidedInput({
      id: 'first-parameters-script-auth',
      outpoint: toOutpoint(params.offerCreationTx.txid, 1),
      finalizer: utilityScriptAuthFinalizer,
    }),
    createProvidedInput({
      id: 'second-parameters-script-auth',
      outpoint: toOutpoint(params.offerCreationTx.txid, 2),
      finalizer: utilityScriptAuthFinalizer,
    }),
    createProvidedInput({
      id: 'borrower-script-auth',
      outpoint: toOutpoint(params.offerCreationTx.txid, 3),
      finalizer: utilityScriptAuthFinalizer,
    }),
    createProvidedInput({
      id: 'lender-script-auth',
      outpoint: toOutpoint(params.offerCreationTx.txid, 4),
      finalizer: utilityScriptAuthFinalizer,
    }),
    createWalletAssetInput(
      'principal-lend',
      artifacts.principalAssetId,
      params.offer.principal_amount
    ),
    ...(artifacts.principalAssetId !== policyAssetId
      ? [createWalletAssetInput('lending-fee', policyAssetId)]
      : []),
  ]
  const outputs: OutputSchema[] = [
    createExplicitOutput({
      id: 'lending',
      amount_sat: toAmountSat(params.offer.collateral_amount, 'Collateral amount'),
      lock: createFinalizerLock(lendingFinalizer),
      assetId: artifacts.collateralAssetId,
    }),
    createExplicitOutput({
      id: 'principal-to-wallet',
      amount_sat: toAmountSat(params.offer.principal_amount, 'Principal amount'),
      lock: createScriptLock(borrowerOutputScript),
      assetId: artifacts.principalAssetId,
    }),
    createExplicitOutput({
      id: 'first-parameters-script-auth',
      amount_sat: toAmountSat(artifacts.firstParametersAmount, 'First parameters amount'),
      lock: createFinalizerLock(parametersOutputFinalizer),
      assetId: artifacts.firstParametersNftAssetId,
    }),
    createExplicitOutput({
      id: 'second-parameters-script-auth',
      amount_sat: toAmountSat(artifacts.secondParametersAmount, 'Second parameters amount'),
      lock: createFinalizerLock(parametersOutputFinalizer),
      assetId: artifacts.secondParametersNftAssetId,
    }),
    createExplicitOutput({
      id: 'borrower-nft-to-wallet',
      amount_sat: 1,
      lock: createScriptLock(borrowerOutputScript),
      assetId: artifacts.borrowerNftAssetId,
    }),
    createExplicitOutput({
      id: 'lender-nft-to-wallet',
      amount_sat: 1,
      lock: createScriptLock(lenderDestinationScript),
      assetId: artifacts.lenderNftAssetId,
    }),
  ]
  return buildRequest(params.network, inputs, outputs, params.feeRateSatKvb)
}

export async function buildRepayLoanRequest(
  params: BuildRepayLoanRequestParams
): Promise<TxCreateRequest> {
  const artifacts = await resolveOfferProtocolArtifacts({
    network: params.network,
    offer: params.offer,
    offerCreationTx: params.offerCreationTx,
  })
  const policyAssetId = getPolicyAssetId(params.network)
  const principalWithInterest = calculatePrincipalWithInterest(
    params.offer.principal_amount,
    params.offer.interest_rate
  )
  const [lendingRepaymentFinalizer, parametersScriptAuthFinalizer, lenderAssetAuthFinalizer] =
    await Promise.all([
      buildLendingFinalizer({
        collateralAssetId: assetIdDisplayToInternal(artifacts.collateralAssetId),
        principalAssetId: assetIdDisplayToInternal(artifacts.principalAssetId),
        borrowerNftAssetId: assetIdDisplayToInternal(artifacts.borrowerNftAssetId),
        lenderNftAssetId: assetIdDisplayToInternal(artifacts.lenderNftAssetId),
        firstParametersNftAssetId: assetIdDisplayToInternal(artifacts.firstParametersNftAssetId),
        secondParametersNftAssetId: assetIdDisplayToInternal(artifacts.secondParametersNftAssetId),
        lenderPrincipalCovHash: artifacts.principalAuthScriptHash,
        lendingParams: artifacts.terms,
        branch: 'LoanRepayment',
      }),
      buildScriptAuthFinalizer(artifacts.lendingCovHash),
      buildAssetAuthFinalizer({
        assetId: assetIdDisplayToInternal(artifacts.lenderNftAssetId),
        assetAmount: 1,
        withAssetBurn: true,
        inputAssetIndex: 0,
        outputAssetIndex: 0,
      }),
    ])
  const inputs: InputSchema[] = [
    createProvidedInput({
      id: 'lending',
      outpoint: toOutpoint(params.lendingTx.txid, 0),
      finalizer: lendingRepaymentFinalizer,
    }),
    createProvidedInput({
      id: 'first-parameters-script-auth',
      outpoint: toOutpoint(params.lendingTx.txid, 2),
      finalizer: parametersScriptAuthFinalizer,
    }),
    createProvidedInput({
      id: 'second-parameters-script-auth',
      outpoint: toOutpoint(params.lendingTx.txid, 3),
      finalizer: parametersScriptAuthFinalizer,
    }),
    createProvidedInput({
      id: 'borrower-nft',
      outpoint: toOutpoint(params.borrowerParticipant.txid, params.borrowerParticipant.vout),
    }),
    createWalletAssetInput('principal-repay', artifacts.principalAssetId, principalWithInterest),
    ...(artifacts.principalAssetId !== policyAssetId
      ? [createWalletAssetInput('repayment-fee', policyAssetId)]
      : []),
  ]
  const outputs: OutputSchema[] = [
    createExplicitOutput({
      id: 'collateral-return',
      amount_sat: toAmountSat(params.offer.collateral_amount, 'Collateral amount'),
      lock: createScriptLock(
        normalizeScriptHex(
          params.collateralDestinationScriptPubkeyHex ?? params.signerScriptPubkeyHex,
          'Collateral destination script'
        )
      ),
      assetId: artifacts.collateralAssetId,
    }),
    createExplicitOutput({
      id: 'lender-asset-auth',
      amount_sat: toAmountSat(principalWithInterest, 'Principal with interest'),
      lock: createFinalizerLock(lenderAssetAuthFinalizer),
      assetId: artifacts.principalAssetId,
    }),
    createBurnOutput(
      'first-parameters-burn',
      artifacts.firstParametersAmount,
      artifacts.firstParametersNftAssetId
    ),
    createBurnOutput(
      'second-parameters-burn',
      artifacts.secondParametersAmount,
      artifacts.secondParametersNftAssetId
    ),
    createBurnOutput('borrower-burn', 1n, artifacts.borrowerNftAssetId),
  ]
  return buildRequest(params.network, inputs, outputs, params.feeRateSatKvb)
}

export async function buildClaimRepaidPrincipalRequest(
  params: BuildClaimRepaidPrincipalRequestParams
): Promise<TxCreateRequest> {
  const artifacts = await resolveOfferProtocolArtifacts({
    network: params.network,
    offer: params.offer,
    offerCreationTx: params.offerCreationTx,
  })
  const policyAssetId = getPolicyAssetId(params.network)
  const principalWithInterest = calculatePrincipalWithInterest(
    params.offer.principal_amount,
    params.offer.interest_rate
  )
  const assetAuthFinalizer = await buildAssetAuthFinalizer({
    assetId: assetIdDisplayToInternal(artifacts.lenderNftAssetId),
    assetAmount: 1,
    withAssetBurn: true,
    inputAssetIndex: 1,
    outputAssetIndex: 1,
  })
  const inputs: InputSchema[] = [
    createProvidedInput({
      id: 'asset-auth',
      outpoint: toOutpoint(params.repaymentTxid, params.repaymentVout),
      finalizer: assetAuthFinalizer,
    }),
    createProvidedInput({
      id: 'lender-nft',
      outpoint: toOutpoint(params.lenderParticipant.txid, params.lenderParticipant.vout),
    }),
    createWalletAssetInput('claim-fee', policyAssetId),
  ]
  const outputs: OutputSchema[] = [
    createExplicitOutput({
      id: 'principal-claim',
      amount_sat: toAmountSat(principalWithInterest, 'Principal with interest'),
      lock: createScriptLock(
        normalizeScriptHex(
          params.principalDestinationScriptPubkeyHex ?? params.signerScriptPubkeyHex,
          'Principal destination script'
        )
      ),
      assetId: artifacts.principalAssetId,
    }),
    createBurnOutput('lender-burn', 1n, artifacts.lenderNftAssetId),
  ]
  return buildRequest(params.network, inputs, outputs, params.feeRateSatKvb)
}

export async function buildLiquidateLoanRequest(
  params: BuildLiquidateLoanRequestParams
): Promise<TxCreateRequest> {
  const artifacts = await resolveOfferProtocolArtifacts({
    network: params.network,
    offer: params.offer,
    offerCreationTx: params.offerCreationTx,
  })
  const policyAssetId = getPolicyAssetId(params.network)
  const [lendingLiquidationFinalizer, parametersScriptAuthFinalizer] = await Promise.all([
    buildLendingFinalizer({
      collateralAssetId: assetIdDisplayToInternal(artifacts.collateralAssetId),
      principalAssetId: assetIdDisplayToInternal(artifacts.principalAssetId),
      borrowerNftAssetId: assetIdDisplayToInternal(artifacts.borrowerNftAssetId),
      lenderNftAssetId: assetIdDisplayToInternal(artifacts.lenderNftAssetId),
      firstParametersNftAssetId: assetIdDisplayToInternal(artifacts.firstParametersNftAssetId),
      secondParametersNftAssetId: assetIdDisplayToInternal(artifacts.secondParametersNftAssetId),
      lenderPrincipalCovHash: artifacts.principalAuthScriptHash,
      lendingParams: artifacts.terms,
      branch: 'LoanLiquidation',
    }),
    buildScriptAuthFinalizer(artifacts.lendingCovHash),
  ])
  const inputs: InputSchema[] = [
    createProvidedInput({
      id: 'lending',
      outpoint: toOutpoint(params.lendingTx.txid, 0),
      finalizer: lendingLiquidationFinalizer,
    }),
    createProvidedInput({
      id: 'first-parameters-script-auth',
      outpoint: toOutpoint(params.lendingTx.txid, 2),
      finalizer: parametersScriptAuthFinalizer,
    }),
    createProvidedInput({
      id: 'second-parameters-script-auth',
      outpoint: toOutpoint(params.lendingTx.txid, 3),
      finalizer: parametersScriptAuthFinalizer,
    }),
    createProvidedInput({
      id: 'lender-nft',
      outpoint: toOutpoint(params.lenderParticipant.txid, params.lenderParticipant.vout),
    }),
    createWalletAssetInput('liquidation-fee', policyAssetId),
  ]
  const outputs: OutputSchema[] = [
    createExplicitOutput({
      id: 'collateral-return',
      amount_sat: toAmountSat(params.offer.collateral_amount, 'Collateral amount'),
      lock: createScriptLock(
        normalizeScriptHex(
          params.collateralDestinationScriptPubkeyHex ?? params.signerScriptPubkeyHex,
          'Collateral destination script'
        )
      ),
      assetId: artifacts.collateralAssetId,
    }),
    createBurnOutput(
      'first-parameters-burn',
      artifacts.firstParametersAmount,
      artifacts.firstParametersNftAssetId
    ),
    createBurnOutput(
      'second-parameters-burn',
      artifacts.secondParametersAmount,
      artifacts.secondParametersNftAssetId
    ),
    createBurnOutput('lender-burn', 1n, artifacts.lenderNftAssetId),
  ]
  return buildRequest(
    params.network,
    enableAbsoluteLocktime(inputs),
    outputs,
    params.feeRateSatKvb,
    params.offer.loan_expiration_time
  )
}
