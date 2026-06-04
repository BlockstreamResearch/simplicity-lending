import {
  type Network,
  SimplicityArguments,
  SimplicityProgram,
  SimplicityType,
  SimplicityTypedValue,
  SimplicityWitnessValues,
  type XOnlyPublicKey,
} from 'lwk_web'
import { sources } from 'virtual:simplicity-sources'

import { type AssetAuthProgramParams, loadAssetAuthProgram } from '@/simplicity/asset-auth/program'
import {
  type AssetAuthVaultProgramParams,
  buildActiveAssetAuthVaultParams,
  buildFinalizedAssetAuthVaultParams,
  loadAssetAuthVaultProgram,
} from '@/simplicity/asset-auth-vault/program'
import { bytes32ToHex, hexToBytes } from '@/utils/hex'
import { isUint16, isUint32, isUint64 } from '@/utils/uint'

const ARGUMENTS = {
  COLLATERAL_ASSET_ID: 'COLLATERAL_ASSET_ID',
  PRINCIPAL_ASSET_ID: 'PRINCIPAL_ASSET_ID',
  BORROWER_NFT_ASSET_ID: 'BORROWER_NFT_ASSET_ID',
  LENDER_NFT_ASSET_ID: 'LENDER_NFT_ASSET_ID',
  COLLATERAL_AMOUNT: 'COLLATERAL_AMOUNT',
  PRINCIPAL_AMOUNT: 'PRINCIPAL_AMOUNT',
  PRINCIPAL_INTEREST_RATE: 'PRINCIPAL_INTEREST_RATE',
  LOAN_EXPIRATION_TIME: 'LOAN_EXPIRATION_TIME',
  LENDER_VAULT_COV_HASH: 'LENDER_VAULT_COV_HASH',
  FINALIZED_LENDER_VAULT_COV_HASH: 'FINALIZED_LENDER_VAULT_COV_HASH',
  PROTOCOL_FEE_VAULT_COV_HASH: 'PROTOCOL_FEE_VAULT_COV_HASH',
  FINALIZED_PROTOCOL_FEE_VAULT_COV_HASH: 'FINALIZED_PROTOCOL_FEE_VAULT_COV_HASH',
  PRINCIPAL_OUTPUT_SCRIPT_HASH: 'PRINCIPAL_OUTPUT_SCRIPT_HASH',
} as const

const WITNESS = {
  PATH: 'PATH',
} as const

export interface OfferParameters {
  collateralAmount: bigint
  principalAmount: bigint
  principalInterestRate: number
  loanExpirationTime: number
}

export interface LendingOfferProgramParams {
  collateralAssetId: Uint8Array
  principalAssetId: Uint8Array
  borrowerNftAssetId: Uint8Array
  lenderNftAssetId: Uint8Array
  protocolFeeKeeperAssetId: Uint8Array
  offerParameters: OfferParameters
  lenderVaultCovHash: Uint8Array
  finalizedLenderVaultCovHash: Uint8Array
  protocolFeeVaultCovHash: Uint8Array
  finalizedProtocolFeeVaultCovHash: Uint8Array
  principalOutputScriptHash: Uint8Array
}

export type LendingOfferWitnessParams =
  | { branch: 'OfferAcceptance' }
  | { branch: 'OfferCancellation' }
  | { branch: 'PartialRepayment'; currentDebt: bigint; amountToRepay: bigint }
  | { branch: 'FullRepayment'; currentDebt: bigint }
  | { branch: 'Liquidation'; currentDebt: bigint }

export function loadLendingProgram(params: LendingOfferProgramParams): SimplicityProgram {
  return SimplicityProgram.load(sources.lending, buildLendingArguments(params))
}

export function buildLendingArguments(params: LendingOfferProgramParams): SimplicityArguments {
  assertBytes32(params.collateralAssetId, 'collateralAssetId')
  assertBytes32(params.principalAssetId, 'principalAssetId')
  assertBytes32(params.borrowerNftAssetId, 'borrowerNftAssetId')
  assertBytes32(params.lenderNftAssetId, 'lenderNftAssetId')
  assertBytes32(params.lenderVaultCovHash, 'lenderVaultCovHash')
  assertBytes32(params.finalizedLenderVaultCovHash, 'finalizedLenderVaultCovHash')
  assertBytes32(params.protocolFeeVaultCovHash, 'protocolFeeVaultCovHash')
  assertBytes32(params.finalizedProtocolFeeVaultCovHash, 'finalizedProtocolFeeVaultCovHash')
  assertBytes32(params.principalOutputScriptHash, 'principalOutputScriptHash')
  assertOfferParameters(params.offerParameters)

  return new SimplicityArguments()
    .addValue(
      ARGUMENTS.COLLATERAL_ASSET_ID,
      SimplicityTypedValue.fromU256Hex(bytes32ToHex(params.collateralAssetId)),
    )
    .addValue(
      ARGUMENTS.PRINCIPAL_ASSET_ID,
      SimplicityTypedValue.fromU256Hex(bytes32ToHex(params.principalAssetId)),
    )
    .addValue(
      ARGUMENTS.BORROWER_NFT_ASSET_ID,
      SimplicityTypedValue.fromU256Hex(bytes32ToHex(params.borrowerNftAssetId)),
    )
    .addValue(
      ARGUMENTS.LENDER_NFT_ASSET_ID,
      SimplicityTypedValue.fromU256Hex(bytes32ToHex(params.lenderNftAssetId)),
    )
    .addValue(
      ARGUMENTS.COLLATERAL_AMOUNT,
      SimplicityTypedValue.fromU64(params.offerParameters.collateralAmount),
    )
    .addValue(
      ARGUMENTS.PRINCIPAL_AMOUNT,
      SimplicityTypedValue.fromU64(params.offerParameters.principalAmount),
    )
    .addValue(
      ARGUMENTS.PRINCIPAL_INTEREST_RATE,
      SimplicityTypedValue.fromU64(BigInt(params.offerParameters.principalInterestRate)),
    )
    .addValue(
      ARGUMENTS.LOAN_EXPIRATION_TIME,
      SimplicityTypedValue.fromU32(params.offerParameters.loanExpirationTime),
    )
    .addValue(
      ARGUMENTS.LENDER_VAULT_COV_HASH,
      SimplicityTypedValue.fromU256Hex(bytes32ToHex(params.lenderVaultCovHash)),
    )
    .addValue(
      ARGUMENTS.FINALIZED_LENDER_VAULT_COV_HASH,
      SimplicityTypedValue.fromU256Hex(bytes32ToHex(params.finalizedLenderVaultCovHash)),
    )
    .addValue(
      ARGUMENTS.PROTOCOL_FEE_VAULT_COV_HASH,
      SimplicityTypedValue.fromU256Hex(bytes32ToHex(params.protocolFeeVaultCovHash)),
    )
    .addValue(
      ARGUMENTS.FINALIZED_PROTOCOL_FEE_VAULT_COV_HASH,
      SimplicityTypedValue.fromU256Hex(bytes32ToHex(params.finalizedProtocolFeeVaultCovHash)),
    )
    .addValue(
      ARGUMENTS.PRINCIPAL_OUTPUT_SCRIPT_HASH,
      SimplicityTypedValue.fromU256Hex(bytes32ToHex(params.principalOutputScriptHash)),
    )
}

export function buildPrincipalOutputAssetAuthParams(
  params: Pick<LendingOfferProgramParams, 'borrowerNftAssetId' | 'offerParameters'>,
): AssetAuthProgramParams {
  return {
    assetId: params.borrowerNftAssetId,
    assetAmount: getTotalAmountToRepay(params.offerParameters),
    withAssetBurn: false,
  }
}

export function buildFinalizedLenderVaultParams(
  params: Pick<
    LendingOfferProgramParams,
    'principalAssetId' | 'lenderNftAssetId' | 'borrowerNftAssetId'
  >,
): AssetAuthVaultProgramParams {
  return buildFinalizedAssetAuthVaultParams({
    vaultAssetId: params.principalAssetId,
    keeperAuthAssetId: params.lenderNftAssetId,
    keeperAuthAssetAmount: 1n,
    withKeeperAssetBurn: true,
    supplierAuthAssetId: params.borrowerNftAssetId,
    withSupplierAssetBurn: true,
  })
}

export function buildFinalizedProtocolFeeVaultParams(
  params: Pick<
    LendingOfferProgramParams,
    'principalAssetId' | 'protocolFeeKeeperAssetId' | 'borrowerNftAssetId'
  >,
): AssetAuthVaultProgramParams {
  return buildFinalizedAssetAuthVaultParams({
    vaultAssetId: params.principalAssetId,
    keeperAuthAssetId: params.protocolFeeKeeperAssetId,
    keeperAuthAssetAmount: 1n,
    withKeeperAssetBurn: false,
    supplierAuthAssetId: params.borrowerNftAssetId,
    withSupplierAssetBurn: true,
  })
}

export function buildLendingWitness(params: LendingOfferWitnessParams): SimplicityWitnessValues {
  const pathType = SimplicityType.fromString(
    'Either<Either<(), ()>, Either<Either<(u64, u64), u64>, u64>>',
  )

  return new SimplicityWitnessValues().addValue(
    WITNESS.PATH,
    SimplicityTypedValue.parse(buildLendingPathExpression(params), pathType),
  )
}

export function buildDerivedLendingOfferProgramParams(
  params: Omit<
    LendingOfferProgramParams,
    | 'lenderVaultCovHash'
    | 'finalizedLenderVaultCovHash'
    | 'protocolFeeVaultCovHash'
    | 'finalizedProtocolFeeVaultCovHash'
    | 'principalOutputScriptHash'
  >,
  internalKey: XOnlyPublicKey,
  network: Network,
): LendingOfferProgramParams {
  const principalOutputAssetAuth = loadAssetAuthProgram(buildPrincipalOutputAssetAuthParams(params))
  const finalizedLenderVault = loadAssetAuthVaultProgram(buildFinalizedLenderVaultParams(params))
  const finalizedProtocolFeeVault = loadAssetAuthVaultProgram(
    buildFinalizedProtocolFeeVaultParams(params),
  )
  const finalizedLenderVaultCovHash = getProgramScriptHash(
    finalizedLenderVault,
    internalKey,
    network,
  )
  const finalizedProtocolFeeVaultCovHash = getProgramScriptHash(
    finalizedProtocolFeeVault,
    internalKey,
    network,
  )
  const activeLenderVault = loadAssetAuthVaultProgram(
    buildActiveAssetAuthVaultParams(
      buildFinalizedLenderVaultParams(params),
      finalizedLenderVaultCovHash,
    ),
  )
  const activeProtocolFeeVault = loadAssetAuthVaultProgram(
    buildActiveAssetAuthVaultParams(
      buildFinalizedProtocolFeeVaultParams(params),
      finalizedProtocolFeeVaultCovHash,
    ),
  )

  return {
    ...params,
    lenderVaultCovHash: getProgramScriptHash(activeLenderVault, internalKey, network),
    finalizedLenderVaultCovHash,
    protocolFeeVaultCovHash: getProgramScriptHash(activeProtocolFeeVault, internalKey, network),
    finalizedProtocolFeeVaultCovHash,
    principalOutputScriptHash: getProgramScriptHash(principalOutputAssetAuth, internalKey, network),
  }
}

export function getProgramScriptHash(
  program: SimplicityProgram,
  internalKey: XOnlyPublicKey,
  network: Network,
): Uint8Array {
  return hexToBytes(program.createP2trAddress(internalKey, network).scriptPubkey().jet_sha256_hex())
}

export function getTotalAmountToRepay(params: OfferParameters): bigint {
  assertOfferParameters(params)

  return (
    params.principalAmount +
    (params.principalAmount * BigInt(params.principalInterestRate)) / 10_000n
  )
}

export async function buildPendingOfferMetadata(params: {
  principalAssetId: Uint8Array
  offerParameters: Pick<
    OfferParameters,
    'principalAmount' | 'loanExpirationTime' | 'principalInterestRate'
  >
}): Promise<Uint8Array> {
  assertBytes32(params.principalAssetId, 'principalAssetId')
  assertUint64(params.offerParameters.principalAmount, 'principalAmount')
  if (!isUint32(params.offerParameters.loanExpirationTime)) {
    throw new Error('loanExpirationTime must fit into u32')
  }
  if (!isUint16(params.offerParameters.principalInterestRate)) {
    throw new Error('principalInterestRate must fit into u16')
  }

  const programId = await getLendingProgramId()
  const data = new Uint8Array(50)
  const view = new DataView(data.buffer)
  data.set(programId, 0)
  data.set(params.principalAssetId, 4)
  view.setBigUint64(36, params.offerParameters.principalAmount, true)
  view.setUint32(44, params.offerParameters.loanExpirationTime, true)
  view.setUint16(48, params.offerParameters.principalInterestRate, true)
  return data
}

async function getLendingProgramId(): Promise<Uint8Array> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sources.lending))
  return new Uint8Array(hash).slice(0, 4)
}

function buildLendingPathExpression(params: LendingOfferWitnessParams): string {
  switch (params.branch) {
    case 'OfferAcceptance':
      return 'Left(Left(()))'
    case 'OfferCancellation':
      return 'Left(Right(()))'
    case 'PartialRepayment':
      assertUint64(params.currentDebt, 'currentDebt')
      assertUint64(params.amountToRepay, 'amountToRepay')
      return `Right(Left(Left((${params.currentDebt}, ${params.amountToRepay}))))`
    case 'FullRepayment':
      assertUint64(params.currentDebt, 'currentDebt')
      return `Right(Left(Right(${params.currentDebt})))`
    case 'Liquidation':
      assertUint64(params.currentDebt, 'currentDebt')
      return `Right(Right(${params.currentDebt}))`
  }
}

function assertOfferParameters(params: OfferParameters): void {
  assertUint64(params.collateralAmount, 'collateralAmount')
  assertUint64(params.principalAmount, 'principalAmount')
  if (!isUint16(params.principalInterestRate)) {
    throw new Error('principalInterestRate must fit into u16')
  }
  if (!isUint32(params.loanExpirationTime)) {
    throw new Error('loanExpirationTime must fit into u32')
  }
}

function assertBytes32(value: Uint8Array, label: string): void {
  if (value.length !== 32) {
    throw new Error(`${label} must be 32 bytes`)
  }
}

function assertUint64(value: bigint, label: string): void {
  if (!isUint64(value)) {
    throw new Error(`${label} must fit into u64`)
  }
}
