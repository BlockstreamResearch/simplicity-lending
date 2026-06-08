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

import { loadAssetAuthProgram } from '@/simplicity/asset-auth/program'
import {
  type AssetAuthVaultProgramParams,
  loadAssetAuthVaultProgram,
} from '@/simplicity/asset-auth-vault/program'
import { getTotalAmountToRepay } from '@/simplicity/lending/utils'
import { bytes32ToHex, hexToBytes } from '@/utils/hex'
import { sha256 } from '@/utils/sha256'
import {
  type Bytes32,
  toBytes32,
  toUint64,
  type Uint16,
  type Uint32,
  type Uint64,
} from '@/utils/uint'

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
  collateralAmount: Uint64
  principalAmount: Uint64
  principalInterestRate: Uint16
  loanExpirationTime: Uint32
}

export interface LendingOfferProgramParams {
  collateralAssetId: Bytes32
  principalAssetId: Bytes32
  borrowerNftAssetId: Bytes32
  lenderNftAssetId: Bytes32
  protocolFeeKeeperAssetId: Bytes32
  offerParameters: OfferParameters
  lenderVaultCovHash: Bytes32
  finalizedLenderVaultCovHash: Bytes32
  protocolFeeVaultCovHash: Bytes32
  finalizedProtocolFeeVaultCovHash: Bytes32
  principalOutputScriptHash: Bytes32
}

export type LendingOfferWitnessParams =
  | { branch: 'OfferAcceptance' }
  | { branch: 'OfferCancellation' }
  | { branch: 'PartialRepayment'; currentDebt: Uint64; amountToRepay: Uint64 }
  | { branch: 'FullRepayment'; currentDebt: Uint64 }
  | { branch: 'Liquidation'; currentDebt: Uint64 }

export function loadLendingProgram(params: LendingOfferProgramParams): SimplicityProgram {
  return SimplicityProgram.load(sources.lending, buildLendingArguments(params))
}

export function buildLendingArguments(params: LendingOfferProgramParams): SimplicityArguments {
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

function buildFinalizedLenderVaultParams(
  params: Pick<
    LendingOfferProgramParams,
    'principalAssetId' | 'lenderNftAssetId' | 'borrowerNftAssetId'
  >,
): AssetAuthVaultProgramParams {
  return {
    vaultAssetId: params.principalAssetId,
    keeperAuthAssetId: params.lenderNftAssetId,
    keeperAuthAssetAmount: toUint64(1n),
    withKeeperAssetBurn: true,
    supplierAuthAssetId: params.borrowerNftAssetId,
    withSupplierAssetBurn: true,
    finalizedVaultCovHash: toBytes32(new Uint8Array(32)),
    isActive: false,
  }
}

function buildFinalizedProtocolFeeVaultParams(
  params: Pick<
    LendingOfferProgramParams,
    'principalAssetId' | 'protocolFeeKeeperAssetId' | 'borrowerNftAssetId'
  >,
): AssetAuthVaultProgramParams {
  return {
    vaultAssetId: params.principalAssetId,
    keeperAuthAssetId: params.protocolFeeKeeperAssetId,
    keeperAuthAssetAmount: toUint64(1n),
    withKeeperAssetBurn: false,
    supplierAuthAssetId: params.borrowerNftAssetId,
    withSupplierAssetBurn: true,
    finalizedVaultCovHash: toBytes32(new Uint8Array(32)),
    isActive: false,
  }
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
  const principalOutputAssetAuth = loadAssetAuthProgram({
    assetId: params.borrowerNftAssetId,
    assetAmount: getTotalAmountToRepay(params.offerParameters),
    withAssetBurn: false,
  })
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
  const activeLenderVault = loadAssetAuthVaultProgram({
    ...buildFinalizedLenderVaultParams(params),
    finalizedVaultCovHash: finalizedLenderVaultCovHash,
    isActive: true,
  })
  const activeProtocolFeeVault = loadAssetAuthVaultProgram({
    ...buildFinalizedProtocolFeeVaultParams(params),
    finalizedVaultCovHash: finalizedProtocolFeeVaultCovHash,
    isActive: true,
  })

  return {
    ...params,
    lenderVaultCovHash: getProgramScriptHash(activeLenderVault, internalKey, network),
    finalizedLenderVaultCovHash,
    protocolFeeVaultCovHash: getProgramScriptHash(activeProtocolFeeVault, internalKey, network),
    finalizedProtocolFeeVaultCovHash,
    principalOutputScriptHash: getProgramScriptHash(principalOutputAssetAuth, internalKey, network),
  }
}

function getProgramScriptHash(
  program: SimplicityProgram,
  internalKey: XOnlyPublicKey,
  network: Network,
): Bytes32 {
  return toBytes32(
    hexToBytes(program.createP2trAddress(internalKey, network).scriptPubkey().jet_sha256_hex()),
    'programScriptHash',
  )
}

export async function buildPendingOfferMetadata(params: {
  principalAssetId: Bytes32
  offerParameters: Pick<
    OfferParameters,
    'principalAmount' | 'loanExpirationTime' | 'principalInterestRate'
  >
}): Promise<Uint8Array> {
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
  const hash = await sha256(new TextEncoder().encode(sources.lending))
  return new Uint8Array(hash).slice(0, 4)
}

// TODO: Will be used in the offer acceptance,
// cancellation, repayment, and liquidation flows to construct the appropriate witness values for each branch of the program
export function buildLendingWitness(params: LendingOfferWitnessParams): SimplicityWitnessValues {
  const pathType = SimplicityType.fromString(
    'Either<Either<(), ()>, Either<Either<(u64, u64), u64>, u64>>',
  )

  return new SimplicityWitnessValues().addValue(
    WITNESS.PATH,
    SimplicityTypedValue.parse(buildLendingPathExpression(params), pathType),
  )
}

function buildLendingPathExpression(params: LendingOfferWitnessParams): string {
  switch (params.branch) {
    case 'OfferAcceptance':
      return 'Left(Left(()))'
    case 'OfferCancellation':
      return 'Left(Right(()))'
    case 'PartialRepayment':
      return `Right(Left(Left((${params.currentDebt}, ${params.amountToRepay}))))`
    case 'FullRepayment':
      return `Right(Left(Right(${params.currentDebt})))`
    case 'Liquidation':
      return `Right(Right(${params.currentDebt}))`
  }
}
