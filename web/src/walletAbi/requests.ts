import {
  WalletAbiFinalizerSpec,
  WalletAbiInputUnblinding,
  WalletAbiInternalKeySource,
  WalletAbiLockVariant,
  WalletAbiRuntimeSimfWitness,
  WalletAbiSimfArguments,
  WalletAbiSimfWitness,
  WalletAbiStatus,
  scriptFromHex,
  xOnlyPublicKeyFromString,
  type WalletAbiTxCreateRequest,
} from 'lwk_wallet_abi_sdk'
import type { EsploraTx, EsploraVout } from '../api/esplora'
import { hashScriptPubkeyHex } from '../api/esplora'
import type { LwkSimplicityArguments, LwkSimplicityWitnessValues } from '../simplicity'
import {
  buildAssetAuthArguments,
  buildAssetAuthWitness,
  buildLendingArguments,
  buildLendingWitness,
  buildPreLockArguments as buildPreLockSimplicityArguments,
  buildScriptAuthArguments,
  buildScriptAuthWitness,
} from '../simplicity/covenants'
import { getLwk, getSource } from '../simplicity'
import { calculatePrincipalWithInterest } from '../tx/loanRepayment/principalWithInterest'
import { getScriptPubkeyHexFromAddress, P2PK_NETWORK, POLICY_ASSET_ID } from '../utility/addressP2pk'
import {
  encodeFirstNFTParameters,
  encodeSecondNFTParameters,
  percentToBasisPoints,
  toBaseAmount,
} from '../utility/parametersEncoding'
import { buildPreLockArguments, type PreLockArguments } from '../utility/preLockArguments'
import { buildPreLockArgumentsFromOfferCreation, computePreLockCovenantHashes } from '../utility/preLockCovenants'
import { OP_RETURN_BURN_SCRIPT_HEX, requireVout } from '../utility/esploraPrevout'
import { getTaprootUnspendableInternalKey } from '../utility/taprootUnspendableKey'
import { assetIdDisplayToInternal, bytesToHex, getScriptHexFromVout, hexToBytes32 } from '../utility/hex'
import type { OfferShort } from '../types/offers'
import {
  WalletAbiRequestBuilder,
  walletAbiOutPoint,
  walletAbiWalletFilter,
} from './requestBuilder'

const PREPARATION_OUTPUT_AMOUNT = 10n
const PREPARATION_OUTPUT_COUNT = 4
const ZERO_ASSET_ID_HEX = '0'.repeat(64)
const PARAMETER_DECIMALS = 1

export interface WalletAbiBuiltRequest<TMeta = unknown> {
  request: WalletAbiTxCreateRequest
  meta?: TMeta
}

function traceStage(stage: string) {
  const target = globalThis as typeof globalThis & {
    __walletAbiStages?: string[]
  }
  target.__walletAbiStages ??= []
  target.__walletAbiStages.push(stage)
  console.log(stage)
}

async function explicitScript(address: string) {
  return scriptFromHex(await getScriptPubkeyHexFromAddress(address))
}

function burnLock() {
  return WalletAbiLockVariant.script(scriptFromHex(OP_RETURN_BURN_SCRIPT_HEX))
}

function buildOpReturn64ScriptHex(borrowerPubKey: Uint8Array, principalAssetId: Uint8Array) {
  const data = new Uint8Array(64)
  data.set(borrowerPubKey, 0)
  data.set(principalAssetId, 32)
  return `6a40${bytesToHex(data)}`
}

async function simfFinalizer(
  source: string,
  args: LwkSimplicityArguments,
  witness: LwkSimplicityWitnessValues
) {
  return WalletAbiFinalizerSpec.simf(
    source,
    WalletAbiInternalKeySource.bip0341(),
    WalletAbiSimfArguments.fromResolved(args),
    WalletAbiSimfWitness.fromResolved(witness)
  )
}

async function runtimeSimfFinalizer(
  source: string,
  args: LwkSimplicityArguments,
  witness: LwkSimplicityWitnessValues,
  runtimeWitnesses: WalletAbiRuntimeSimfWitness[]
) {
  return WalletAbiFinalizerSpec.simf(
    source,
    WalletAbiInternalKeySource.bip0341(),
    WalletAbiSimfArguments.fromResolved(args),
    WalletAbiSimfWitness.newWithRuntimeArguments(witness, runtimeWitnesses)
  )
}

async function buildPreLockPathWitness(branch: 'LendingCreation' | 'PreLockCancellation') {
  const lwk = await getLwk()
  const witness = new lwk.SimplicityWitnessValues()
  const pathType = new lwk.SimplicityType('Either<(), ()>')
  const pathValue = new lwk.SimplicityTypedValue(
    branch === 'LendingCreation' ? 'Left(())' : 'Right(())',
    pathType
  )
  return witness.addValue('PATH', pathValue)
}

async function buildScriptAuthFinalizer(scriptHash: Uint8Array, inputScriptIndex: number) {
  const lwk = await getLwk()
  return simfFinalizer(
    getSource('script_auth'),
    buildScriptAuthArguments(lwk, { scriptHash }),
    buildScriptAuthWitness(lwk, { inputScriptIndex })
  )
}

async function buildAssetAuthFinalizer(params: {
  assetId: Uint8Array
  assetAmount: number
  withAssetBurn: boolean
  inputAssetIndex: number
  outputAssetIndex: number
}) {
  const lwk = await getLwk()
  return simfFinalizer(
    getSource('asset_auth'),
    buildAssetAuthArguments(lwk, {
      assetId: params.assetId,
      assetAmount: params.assetAmount,
      withAssetBurn: params.withAssetBurn,
    }),
    buildAssetAuthWitness(lwk, {
      inputAssetIndex: params.inputAssetIndex,
      outputAssetIndex: params.outputAssetIndex,
    })
  )
}

async function buildPreLockLendingCreationFinalizer(preLockArguments: PreLockArguments) {
  const lwk = await getLwk()
  return simfFinalizer(
    getSource('pre_lock'),
    buildPreLockSimplicityArguments(lwk, preLockArguments),
    await buildPreLockPathWitness('LendingCreation')
  )
}

async function buildPreLockCancellationFinalizer(
  preLockArguments: PreLockArguments,
  borrowerPubkeyHex: string
) {
  const lwk = await getLwk()
  return runtimeSimfFinalizer(
    getSource('pre_lock'),
    buildPreLockSimplicityArguments(lwk, preLockArguments),
    await buildPreLockPathWitness('PreLockCancellation'),
    [WalletAbiRuntimeSimfWitness.sigHashAll('SIGNATURE', xOnlyPublicKeyFromString(borrowerPubkeyHex))]
  )
}

async function buildLendingRepaymentFinalizer(lendingArgs: Parameters<typeof buildLendingArguments>[1]) {
  const lwk = await getLwk()
  return simfFinalizer(
    getSource('lending'),
    buildLendingArguments(lwk, lendingArgs),
    buildLendingWitness(lwk, { branch: 'LoanRepayment' })
  )
}

async function buildLendingLiquidationFinalizer(lendingArgs: Parameters<typeof buildLendingArguments>[1]) {
  const lwk = await getLwk()
  return simfFinalizer(
    getSource('lending'),
    buildLendingArguments(lwk, lendingArgs),
    buildLendingWitness(lwk, { branch: 'LoanLiquidation' })
  )
}

async function buildLendingArgs(offer: OfferShort, lendingTx: EsploraTx) {
  const lendingPrevout = requireVout(lendingTx, 0, 'Lending', 'lending transaction')
  const firstParametersPrevout = requireVout(
    lendingTx,
    2,
    'First parameters NFT',
    'lending transaction'
  )
  const secondParametersPrevout = requireVout(
    lendingTx,
    3,
    'Second parameters NFT',
    'lending transaction'
  )
  const borrowerNftPrevout = requireVout(lendingTx, 4, 'Borrower NFT', 'lending transaction')
  const lenderNftPrevout = requireVout(lendingTx, 5, 'Lender NFT', 'lending transaction')

  const collateralAssetId = assetIdDisplayToInternal(offer.collateral_asset)
  const principalAssetId = assetIdDisplayToInternal(offer.principal_asset)
  const borrowerNftAssetId = assetIdDisplayToInternal(String(borrowerNftPrevout.asset ?? ''))
  const lenderNftAssetId = assetIdDisplayToInternal(String(lenderNftPrevout.asset ?? ''))
  const firstParametersNftAssetId = assetIdDisplayToInternal(String(firstParametersPrevout.asset ?? ''))
  const secondParametersNftAssetId = assetIdDisplayToInternal(String(secondParametersPrevout.asset ?? ''))

  const lwk = await getLwk()
  const lenderPrincipalAssetAuthArgs = buildAssetAuthArguments(lwk, {
    assetId: lenderNftAssetId,
    assetAmount: 1,
    withAssetBurn: true,
  })
  const { createP2trAddress } = await import('../simplicity')
  const lenderPrincipalAddress = await createP2trAddress({
    source: getSource('asset_auth'),
    args: lenderPrincipalAssetAuthArgs,
    internalKey: getTaprootUnspendableInternalKey(lwk),
    network: P2PK_NETWORK,
  })
  const lenderPrincipalCovHash = await hashScriptPubkeyHex(
    await getScriptPubkeyHexFromAddress(lenderPrincipalAddress)
  )

  return {
    collateralAssetId,
    principalAssetId,
    borrowerNftAssetId,
    lenderNftAssetId,
    firstParametersNftAssetId,
    secondParametersNftAssetId,
    lenderPrincipalCovHash,
    lendingParams: {
      collateralAmount: offer.collateral_amount,
      principalAmount: offer.principal_amount,
      loanExpirationTime: offer.loan_expiration_time,
      principalInterestRate: offer.interest_rate,
    },
    lendingPrevout,
    firstParametersPrevout,
    secondParametersPrevout,
    borrowerNftPrevout,
    lenderNftPrevout,
  }
}

export async function createUtilityTransferRequest(params: {
  recipients: Array<{
    id: string
    address: string
    amountSat: bigint
  }>
  assetIdHex?: string | null
}): Promise<WalletAbiBuiltRequest> {
  const assetIdHex = params.assetIdHex?.trim() || POLICY_ASSET_ID[P2PK_NETWORK]
  const builder = new WalletAbiRequestBuilder()

  for (const recipient of params.recipients) {
    builder.explicitOutput(
      recipient.id,
      await explicitScript(recipient.address),
      assetIdHex,
      recipient.amountSat
    )
  }

  return { request: builder.buildCreate() }
}

export async function createUtilityBurnRequest(params: {
  assetIdHex: string
  amountSat: bigint
}): Promise<WalletAbiBuiltRequest> {
  const builder = new WalletAbiRequestBuilder().rawOutput(
    'burn-output',
    burnLock(),
    params.assetIdHex,
    params.amountSat
  )

  return { request: builder.buildCreate() }
}

export async function createPrepareUtilityRequest(params: {
  recipientAddress: string
}): Promise<WalletAbiBuiltRequest<{ issuanceEntropyHex: string }>> {
  const issuanceEntropy = crypto.getRandomValues(new Uint8Array(32))
  const issuanceEntropyHex = bytesToHex(issuanceEntropy)
  const builder = new WalletAbiRequestBuilder()
    .walletInputByFilter(
      'prepare-funding',
      walletAbiWalletFilter({ assetIdHex: POLICY_ASSET_ID[P2PK_NETWORK] })
    )
    .newIssuance(
      'prepare-funding',
      PREPARATION_OUTPUT_AMOUNT * BigInt(PREPARATION_OUTPUT_COUNT),
      0n,
      issuanceEntropy
    )

  const script = await explicitScript(params.recipientAddress)
  for (let index = 0; index < PREPARATION_OUTPUT_COUNT; index += 1) {
    builder.newIssuanceAssetOutput(`prepared-output-${index}`, script, 0, PREPARATION_OUTPUT_AMOUNT)
  }

  return {
    request: builder.buildCreate(),
    meta: {
      issuanceEntropyHex,
    },
  }
}

export async function createIssueUtilityNftsRequest(params: {
  recipientAddress: string
  prepareTxId: string
  auxiliaryAssetId: string
  issuanceEntropyHex: string
  collateralAmount: bigint
  principalAmount: bigint
  loanExpirationTime: number
  interestPercent: number
}): Promise<
  WalletAbiBuiltRequest<{
    firstParametersAmount: bigint
    secondParametersAmount: bigint
  }>
> {
  traceStage('[wallet-abi] issue:build-params:start')
  const firstParametersAmount = encodeFirstNFTParameters(
    percentToBasisPoints(params.interestPercent),
    params.loanExpirationTime,
    PARAMETER_DECIMALS,
    PARAMETER_DECIMALS
  )
  const secondParametersAmount = encodeSecondNFTParameters(
    toBaseAmount(params.collateralAmount, PARAMETER_DECIMALS),
    toBaseAmount(params.principalAmount, PARAMETER_DECIMALS)
  )
  const issuanceEntropy = hexToBytes32(params.issuanceEntropyHex)
  traceStage('[wallet-abi] issue:build-params:done')
  traceStage('[wallet-abi] issue:recipient-script:start')
  const recipientScript = await explicitScript(params.recipientAddress)
  traceStage('[wallet-abi] issue:recipient-script:done')
  const builder = new WalletAbiRequestBuilder()
  traceStage('[wallet-abi] issue:builder:created')
  builder.providedInput(
    'first-parameters-input',
    walletAbiOutPoint(params.prepareTxId, 0),
    WalletAbiFinalizerSpec.wallet(),
    WalletAbiInputUnblinding.wallet()
  )
  traceStage('[wallet-abi] issue:wallet-input:first')
  builder.providedInput(
    'second-parameters-input',
    walletAbiOutPoint(params.prepareTxId, 1),
    WalletAbiFinalizerSpec.wallet(),
    WalletAbiInputUnblinding.wallet()
  )
  traceStage('[wallet-abi] issue:wallet-input:second')
  builder.providedInput(
    'borrower-input',
    walletAbiOutPoint(params.prepareTxId, 2),
    WalletAbiFinalizerSpec.wallet(),
    WalletAbiInputUnblinding.wallet()
  )
  traceStage('[wallet-abi] issue:wallet-input:borrower')
  builder.providedInput(
    'lender-input',
    walletAbiOutPoint(params.prepareTxId, 3),
    WalletAbiFinalizerSpec.wallet(),
    WalletAbiInputUnblinding.wallet()
  )
  traceStage('[wallet-abi] issue:wallet-input:lender')
  builder.newIssuance('first-parameters-input', firstParametersAmount, 0n, issuanceEntropy)
  traceStage('[wallet-abi] issue:new-issuance:first')
  builder.newIssuance('second-parameters-input', secondParametersAmount, 0n, issuanceEntropy)
  traceStage('[wallet-abi] issue:new-issuance:second')
  builder.newIssuance('borrower-input', 1n, 0n, issuanceEntropy)
  traceStage('[wallet-abi] issue:new-issuance:borrower')
  builder.newIssuance('lender-input', 1n, 0n, issuanceEntropy)
  traceStage('[wallet-abi] issue:new-issuance:lender')
  builder.newIssuanceAssetOutput('first-parameters-nft', recipientScript, 0, firstParametersAmount)
  traceStage('[wallet-abi] issue:new-output:first')
  builder.newIssuanceAssetOutput('second-parameters-nft', recipientScript, 1, secondParametersAmount)
  traceStage('[wallet-abi] issue:new-output:second')
  builder.newIssuanceAssetOutput('borrower-nft', recipientScript, 2, 1n)
  traceStage('[wallet-abi] issue:new-output:borrower')
  builder.newIssuanceAssetOutput('lender-nft', recipientScript, 3, 1n)
  traceStage('[wallet-abi] issue:new-output:lender')

  for (let index = 0; index < PREPARATION_OUTPUT_COUNT; index += 1) {
    builder.explicitOutput(
      `returned-prepare-${index}`,
      recipientScript,
      params.auxiliaryAssetId,
      PREPARATION_OUTPUT_AMOUNT
    )
    traceStage(`[wallet-abi] issue:return-output:${index}`)
  }

  traceStage('[wallet-abi] issue:build:return')
  return {
    request: builder.buildCreate(),
    meta: {
      firstParametersAmount,
      secondParametersAmount,
    },
  }
}

export async function createPreLockRequest(params: {
  borrowerAddress: string
  principalAssetId: string
  borrowerPubkeyHex: string
  firstParametersNftAssetId: string
  secondParametersNftAssetId: string
  borrowerNftAssetId: string
  lenderNftAssetId: string
  collateralAmount: bigint
  principalAmount: bigint
  loanExpirationTime: number
  interestRateBasisPoints: number
}): Promise<WalletAbiBuiltRequest> {
  const firstParametersAmount = encodeFirstNFTParameters(
    params.interestRateBasisPoints,
    params.loanExpirationTime,
    PARAMETER_DECIMALS,
    PARAMETER_DECIMALS
  )
  const secondParametersAmount = encodeSecondNFTParameters(
    toBaseAmount(params.collateralAmount, PARAMETER_DECIMALS),
    toBaseAmount(params.principalAmount, PARAMETER_DECIMALS)
  )
  const borrowerPubKey = hexToBytes32(params.borrowerPubkeyHex)
  const collateralAssetId = assetIdDisplayToInternal(POLICY_ASSET_ID[P2PK_NETWORK])
  const principalAssetId = assetIdDisplayToInternal(params.principalAssetId)
  const firstParametersNftAssetId = assetIdDisplayToInternal(params.firstParametersNftAssetId)
  const secondParametersNftAssetId = assetIdDisplayToInternal(params.secondParametersNftAssetId)
  const borrowerNftAssetId = assetIdDisplayToInternal(params.borrowerNftAssetId)
  const lenderNftAssetId = assetIdDisplayToInternal(params.lenderNftAssetId)

  const lendingParams = {
    collateralAmount: params.collateralAmount,
    principalAmount: params.principalAmount,
    loanExpirationTime: params.loanExpirationTime,
    principalInterestRate: params.interestRateBasisPoints,
  }
  const borrowerOutputScriptHex = await getScriptPubkeyHexFromAddress(params.borrowerAddress)

  const hashes = await computePreLockCovenantHashes({
    collateralAssetId,
    principalAssetId,
    borrowerNftAssetId,
    lenderNftAssetId,
    firstParametersNftAssetId,
    secondParametersNftAssetId,
    lendingParams,
    borrowerPubKey,
    borrowerOutputScriptHex,
    network: P2PK_NETWORK,
  })

  buildPreLockArguments({
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

  const builder = new WalletAbiRequestBuilder()
    .rawOutput(
      'locked-collateral',
      WalletAbiLockVariant.script(scriptFromHex(hashes.preLockScriptPubkeyHex)),
      POLICY_ASSET_ID[P2PK_NETWORK],
      params.collateralAmount
    )
    .rawOutput(
      'locked-first-parameter-nft',
      WalletAbiLockVariant.script(scriptFromHex(hashes.utilityNftsOutputScriptHex)),
      params.firstParametersNftAssetId,
      firstParametersAmount
    )
    .rawOutput(
      'locked-second-parameter-nft',
      WalletAbiLockVariant.script(scriptFromHex(hashes.utilityNftsOutputScriptHex)),
      params.secondParametersNftAssetId,
      secondParametersAmount
    )
    .rawOutput(
      'locked-borrower-nft',
      WalletAbiLockVariant.script(scriptFromHex(hashes.utilityNftsOutputScriptHex)),
      params.borrowerNftAssetId,
      1n
    )
    .rawOutput(
      'locked-lender-nft',
      WalletAbiLockVariant.script(scriptFromHex(hashes.utilityNftsOutputScriptHex)),
      params.lenderNftAssetId,
      1n
    )
    .rawOutput(
      'creation-op-return',
      WalletAbiLockVariant.script(
        scriptFromHex(buildOpReturn64ScriptHex(borrowerPubKey, principalAssetId))
      ),
      ZERO_ASSET_ID_HEX,
      0n
    )

  return { request: builder.buildCreate() }
}

export async function createCancelPreLockRequest(params: {
  offer: OfferShort
  offerCreationTx: EsploraTx
  borrowerAddress: string
  borrowerPubkeyHex: string
}): Promise<WalletAbiBuiltRequest> {
  const { preLockArguments } = await buildPreLockArgumentsFromOfferCreation(
    params.offer,
    params.offerCreationTx,
    P2PK_NETWORK
  )
  const preLockScriptHash = await hashScriptPubkeyHex(
    getScriptHexFromVout(requireVout(params.offerCreationTx, 0, 'PreLock', 'offer creation transaction'))
  )
  const utilityNftsFinalizer = await buildScriptAuthFinalizer(preLockScriptHash, 0)
  const builder = new WalletAbiRequestBuilder()
    .providedInput(
      'locked-collateral',
      walletAbiOutPoint(params.offerCreationTx.txid, 0),
      await buildPreLockCancellationFinalizer(preLockArguments, params.borrowerPubkeyHex),
      WalletAbiInputUnblinding.explicit()
    )
    .providedInput(
      'first-parameter-nft',
      walletAbiOutPoint(params.offerCreationTx.txid, 1),
      utilityNftsFinalizer,
      WalletAbiInputUnblinding.explicit()
    )
    .providedInput(
      'second-parameter-nft',
      walletAbiOutPoint(params.offerCreationTx.txid, 2),
      utilityNftsFinalizer,
      WalletAbiInputUnblinding.explicit()
    )
    .providedInput(
      'borrower-nft',
      walletAbiOutPoint(params.offerCreationTx.txid, 3),
      utilityNftsFinalizer,
      WalletAbiInputUnblinding.explicit()
    )
    .providedInput(
      'lender-nft',
      walletAbiOutPoint(params.offerCreationTx.txid, 4),
      utilityNftsFinalizer,
      WalletAbiInputUnblinding.explicit()
    )
    .explicitOutput(
      'returned-collateral',
      await explicitScript(params.borrowerAddress),
      params.offer.collateral_asset,
      params.offer.collateral_amount
    )
    .rawOutput(
      'burned-first-parameter-nft',
      burnLock(),
      String(requireVout(params.offerCreationTx, 1, 'First parameter NFT', 'offer creation transaction').asset ?? ''),
      BigInt(requireVout(params.offerCreationTx, 1, 'First parameter NFT', 'offer creation transaction').value ?? 0)
    )
    .rawOutput(
      'burned-second-parameter-nft',
      burnLock(),
      String(requireVout(params.offerCreationTx, 2, 'Second parameter NFT', 'offer creation transaction').asset ?? ''),
      BigInt(requireVout(params.offerCreationTx, 2, 'Second parameter NFT', 'offer creation transaction').value ?? 0)
    )
    .rawOutput(
      'burned-borrower-nft',
      burnLock(),
      String(requireVout(params.offerCreationTx, 3, 'Borrower NFT', 'offer creation transaction').asset ?? ''),
      1n
    )
    .rawOutput(
      'burned-lender-nft',
      burnLock(),
      String(requireVout(params.offerCreationTx, 4, 'Lender NFT', 'offer creation transaction').asset ?? ''),
      1n
    )

  return { request: builder.buildCreate() }
}

export async function createAcceptOfferRequest(params: {
  offer: OfferShort
  offerCreationTx: EsploraTx
  lenderAddress: string
}): Promise<WalletAbiBuiltRequest> {
  const {
    preLockArguments,
    lendingCovHash,
    principalAuthScriptHash,
    lendingScriptPubkeyHex,
    parametersNftScriptPubkeyHex,
    borrowerScriptPubkeyHex,
  } = await buildPreLockArgumentsFromOfferCreation(params.offer, params.offerCreationTx, P2PK_NETWORK)

  const preLockScriptHash = await hashScriptPubkeyHex(
    getScriptHexFromVout(requireVout(params.offerCreationTx, 0, 'PreLock', 'offer creation transaction'))
  )
  const utilityNftsFinalizer = await buildScriptAuthFinalizer(preLockScriptHash, 0)
  const parameterNftsFinalizer = await buildScriptAuthFinalizer(lendingCovHash, 0)
  const lendingFinalizer = await buildLendingRepaymentFinalizer({
    collateralAssetId: preLockArguments.collateralAssetId,
    principalAssetId: preLockArguments.principalAssetId,
    borrowerNftAssetId: preLockArguments.borrowerNftAssetId,
    lenderNftAssetId: preLockArguments.lenderNftAssetId,
    firstParametersNftAssetId: preLockArguments.firstParametersNftAssetId,
    secondParametersNftAssetId: preLockArguments.secondParametersNftAssetId,
    lenderPrincipalCovHash: principalAuthScriptHash,
    lendingParams: {
      collateralAmount: params.offer.collateral_amount,
      principalAmount: params.offer.principal_amount,
      loanExpirationTime: params.offer.loan_expiration_time,
      principalInterestRate: params.offer.interest_rate,
    },
  })

  const builder = new WalletAbiRequestBuilder()
    .providedInput(
      'locked-collateral',
      walletAbiOutPoint(params.offerCreationTx.txid, 0),
      await buildPreLockLendingCreationFinalizer(preLockArguments)
    )
    .providedInput('first-parameter-nft', walletAbiOutPoint(params.offerCreationTx.txid, 1), utilityNftsFinalizer)
    .providedInput('second-parameter-nft', walletAbiOutPoint(params.offerCreationTx.txid, 2), utilityNftsFinalizer)
    .providedInput('borrower-nft', walletAbiOutPoint(params.offerCreationTx.txid, 3), utilityNftsFinalizer)
    .providedInput('lender-nft', walletAbiOutPoint(params.offerCreationTx.txid, 4), utilityNftsFinalizer)
    .finalizerOutput(
      'locked-collateral',
      lendingFinalizer,
      params.offer.collateral_asset,
      params.offer.collateral_amount
    )
    .explicitOutput(
      'borrower-principal',
      scriptFromHex(borrowerScriptPubkeyHex),
      params.offer.principal_asset,
      params.offer.principal_amount
    )
    .finalizerOutput(
      'locked-first-parameter-nft',
      parameterNftsFinalizer,
      String(requireVout(params.offerCreationTx, 1, 'First parameter NFT', 'offer creation transaction').asset ?? ''),
      BigInt(requireVout(params.offerCreationTx, 1, 'First parameter NFT', 'offer creation transaction').value ?? 0)
    )
    .finalizerOutput(
      'locked-second-parameter-nft',
      parameterNftsFinalizer,
      String(requireVout(params.offerCreationTx, 2, 'Second parameter NFT', 'offer creation transaction').asset ?? ''),
      BigInt(requireVout(params.offerCreationTx, 2, 'Second parameter NFT', 'offer creation transaction').value ?? 0)
    )
    .explicitOutput(
      'borrower-nft-output',
      scriptFromHex(borrowerScriptPubkeyHex),
      String(requireVout(params.offerCreationTx, 3, 'Borrower NFT', 'offer creation transaction').asset ?? ''),
      1n
    )
    .explicitOutput(
      'lender-nft-output',
      await explicitScript(params.lenderAddress),
      String(requireVout(params.offerCreationTx, 4, 'Lender NFT', 'offer creation transaction').asset ?? ''),
      1n
    )

  void lendingScriptPubkeyHex
  void parametersNftScriptPubkeyHex

  return { request: builder.buildCreate() }
}

export async function createRepayLoanRequest(params: {
  offer: OfferShort
  lendingTx: EsploraTx
  borrowerAddress: string
}): Promise<WalletAbiBuiltRequest> {
  const context = await buildLendingArgs(params.offer, params.lendingTx)
  const principalWithInterest = calculatePrincipalWithInterest(
    params.offer.principal_amount,
    params.offer.interest_rate
  )
  const builder = new WalletAbiRequestBuilder()
    .providedInput(
      'locked-collateral',
      walletAbiOutPoint(params.lendingTx.txid, 0),
      await buildLendingRepaymentFinalizer({
        collateralAssetId: context.collateralAssetId,
        principalAssetId: context.principalAssetId,
        borrowerNftAssetId: context.borrowerNftAssetId,
        lenderNftAssetId: context.lenderNftAssetId,
        firstParametersNftAssetId: context.firstParametersNftAssetId,
        secondParametersNftAssetId: context.secondParametersNftAssetId,
        lenderPrincipalCovHash: context.lenderPrincipalCovHash,
        lendingParams: context.lendingParams,
      })
    )
    .providedInput(
      'first-parameter-nft',
      walletAbiOutPoint(params.lendingTx.txid, 2),
      await buildScriptAuthFinalizer(
        await hashScriptPubkeyHex(getScriptHexFromVout(context.lendingPrevout)),
        0
      )
    )
    .providedInput(
      'second-parameter-nft',
      walletAbiOutPoint(params.lendingTx.txid, 3),
      await buildScriptAuthFinalizer(
        await hashScriptPubkeyHex(getScriptHexFromVout(context.lendingPrevout)),
        0
      )
    )
    .walletInputByFilter(
      'borrower-nft',
      walletAbiWalletFilter({
        assetIdHex: String(context.borrowerNftPrevout.asset ?? ''),
      })
    )
    .explicitOutput(
      'returned-collateral',
      await explicitScript(params.borrowerAddress),
      params.offer.collateral_asset,
      params.offer.collateral_amount
    )
    .finalizerOutput(
      'locked-lender-principal',
      await buildAssetAuthFinalizer({
        assetId: context.lenderNftAssetId,
        assetAmount: 1,
        withAssetBurn: true,
        inputAssetIndex: 1,
        outputAssetIndex: 1,
      }),
      params.offer.principal_asset,
      principalWithInterest
    )
    .rawOutput(
      'burned-first-parameter-nft',
      burnLock(),
      String(context.firstParametersPrevout.asset ?? ''),
      BigInt(context.firstParametersPrevout.value ?? 0)
    )
    .rawOutput(
      'burned-second-parameter-nft',
      burnLock(),
      String(context.secondParametersPrevout.asset ?? ''),
      BigInt(context.secondParametersPrevout.value ?? 0)
    )
    .rawOutput(
      'burned-borrower-nft',
      burnLock(),
      String(context.borrowerNftPrevout.asset ?? ''),
      1n
    )

  return { request: builder.buildCreate() }
}

export async function createClaimLenderPrincipalRequest(params: {
  offer: OfferShort
  repaymentTx: EsploraTx
  lenderAddress: string
  lenderNftAssetId: string
}): Promise<WalletAbiBuiltRequest> {
  const principalWithInterest = calculatePrincipalWithInterest(
    params.offer.principal_amount,
    params.offer.interest_rate
  )
  const lenderNftAssetId = assetIdDisplayToInternal(params.lenderNftAssetId)
  const builder = new WalletAbiRequestBuilder()
    .providedInput(
      'locked-lender-principal',
      walletAbiOutPoint(params.repaymentTx.txid, 1),
      await buildAssetAuthFinalizer({
        assetId: lenderNftAssetId,
        assetAmount: 1,
        withAssetBurn: true,
        inputAssetIndex: 1,
        outputAssetIndex: 1,
      })
    )
    .walletInputByFilter(
      'lender-nft',
      walletAbiWalletFilter({
        assetIdHex: params.lenderNftAssetId,
      })
    )
    .explicitOutput(
      'claimed-principal',
      await explicitScript(params.lenderAddress),
      params.offer.principal_asset,
      principalWithInterest
    )
    .rawOutput('burned-lender-nft', burnLock(), params.lenderNftAssetId, 1n)

  return { request: builder.buildCreate() }
}

export async function createLiquidateLoanRequest(params: {
  offer: OfferShort
  lendingTx: EsploraTx
  lenderAddress: string
  lenderNftAssetId: string
}): Promise<WalletAbiBuiltRequest> {
  const context = await buildLendingArgs(params.offer, params.lendingTx)
  const lendingScriptHash = await hashScriptPubkeyHex(getScriptHexFromVout(context.lendingPrevout))
  const builder = new WalletAbiRequestBuilder()
    .providedInput(
      'locked-collateral',
      walletAbiOutPoint(params.lendingTx.txid, 0),
      await buildLendingLiquidationFinalizer({
        collateralAssetId: context.collateralAssetId,
        principalAssetId: context.principalAssetId,
        borrowerNftAssetId: context.borrowerNftAssetId,
        lenderNftAssetId: context.lenderNftAssetId,
        firstParametersNftAssetId: context.firstParametersNftAssetId,
        secondParametersNftAssetId: context.secondParametersNftAssetId,
        lenderPrincipalCovHash: context.lenderPrincipalCovHash,
        lendingParams: context.lendingParams,
      })
    )
    .providedInput(
      'first-parameter-nft',
      walletAbiOutPoint(params.lendingTx.txid, 2),
      await buildScriptAuthFinalizer(lendingScriptHash, 0)
    )
    .providedInput(
      'second-parameter-nft',
      walletAbiOutPoint(params.lendingTx.txid, 3),
      await buildScriptAuthFinalizer(lendingScriptHash, 0)
    )
    .walletInputByFilter(
      'lender-nft',
      walletAbiWalletFilter({
        assetIdHex: params.lenderNftAssetId,
      })
    )
    .lockTimeHeight(params.offer.loan_expiration_time)
    .explicitOutput(
      'returned-collateral',
      await explicitScript(params.lenderAddress),
      params.offer.collateral_asset,
      params.offer.collateral_amount
    )
    .rawOutput(
      'burned-first-parameter-nft',
      burnLock(),
      String(context.firstParametersPrevout.asset ?? ''),
      BigInt(context.firstParametersPrevout.value ?? 0)
    )
    .rawOutput(
      'burned-second-parameter-nft',
      burnLock(),
      String(context.secondParametersPrevout.asset ?? ''),
      BigInt(context.secondParametersPrevout.value ?? 0)
    )
    .rawOutput('burned-lender-nft', burnLock(), params.lenderNftAssetId, 1n)

  return { request: builder.buildCreate() }
}

export async function createScriptAuthCreateRequest(params: {
  scriptHex: string
  assetIdHex?: string | null
  amountSat: bigint
}) {
  const scriptHash = await hashScriptPubkeyHex(params.scriptHex)
  const lwk = await getLwk()
  const { createP2trAddress } = await import('../simplicity')
  const address = await createP2trAddress({
    source: getSource('script_auth'),
    args: buildScriptAuthArguments(lwk, { scriptHash }),
    internalKey: getTaprootUnspendableInternalKey(lwk),
    network: P2PK_NETWORK,
  })
  const scriptAuthScript = scriptFromHex(await getScriptPubkeyHexFromAddress(address))

  const builder = new WalletAbiRequestBuilder().rawOutput(
    'locked-script',
    WalletAbiLockVariant.script(scriptAuthScript),
    params.assetIdHex ?? POLICY_ASSET_ID[P2PK_NETWORK],
    params.amountSat
  )

  return { request: builder.buildCreate() }
}

export async function createAssetAuthCreateRequest(params: {
  authAssetIdHex: string
  lockedAssetIdHex?: string | null
  lockedAmountSat: bigint
  withAssetBurn: boolean
}) {
  const lwk = await getLwk()
  const { createP2trAddress } = await import('../simplicity')
  const address = await createP2trAddress({
    source: getSource('asset_auth'),
    args: buildAssetAuthArguments(lwk, {
      assetId: assetIdDisplayToInternal(params.authAssetIdHex),
      assetAmount: 1,
      withAssetBurn: params.withAssetBurn,
    }),
    internalKey: getTaprootUnspendableInternalKey(lwk),
    network: P2PK_NETWORK,
  })
  const assetAuthScript = scriptFromHex(await getScriptPubkeyHexFromAddress(address))

  const builder = new WalletAbiRequestBuilder().rawOutput(
    'locked-script',
    WalletAbiLockVariant.script(assetAuthScript),
    params.lockedAssetIdHex ?? POLICY_ASSET_ID[P2PK_NETWORK],
    params.lockedAmountSat
  )

  return { request: builder.buildCreate() }
}

export async function createScriptAuthUnlockRequest(params: {
  txid: string
  vout: number
  lockedPrevout: EsploraVout
  destinationAddress: string
}) {
  const scriptHash = await hashScriptPubkeyHex(
    await getScriptPubkeyHexFromAddress(params.destinationAddress)
  )
  const builder = new WalletAbiRequestBuilder()
    .providedInput(
      'locked-script',
      walletAbiOutPoint(params.txid, params.vout),
      await buildScriptAuthFinalizer(scriptHash, 1)
    )
    .explicitOutput(
      'unlocked-output',
      await explicitScript(params.destinationAddress),
      String(params.lockedPrevout.asset ?? POLICY_ASSET_ID[P2PK_NETWORK]),
      BigInt(params.lockedPrevout.value ?? 0)
    )

  return { request: builder.buildCreate() }
}

export function walletAbiResponseSucceeded(status: WalletAbiStatus) {
  return status === WalletAbiStatus.Ok
}
