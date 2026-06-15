import {
  SimplicityArguments,
  SimplicityProgram,
  SimplicityType,
  SimplicityTypedValue,
  SimplicityWitnessValues,
  StateTaprootBuilder,
  type StateTaprootSpendInfo,
  XOnlyPublicKey,
} from 'lwk_web'
import { sources } from 'virtual:simplicity-sources'

import { loadAssetAuthProgram } from '@/simplicity/asset-auth/program'
import {
  type AssetAuthVaultProgramParams,
  loadAssetAuthVaultProgram,
} from '@/simplicity/asset-auth-vault/program'
import { getTotalAmountToRepay } from '@/simplicity/lending/utils'
import { buildCovenantSpendInfo, UNSPENDABLE_TAPROOT_PUBKEY } from '@/simplicity/taproot'
import { bytes32ToHex, hexToBytes } from '@/utils/hex'
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
): LendingOfferProgramParams {
  const principalOutputAssetAuth = loadAssetAuthProgram({
    assetId: params.borrowerNftAssetId,
    assetAmount: toUint64(1n),
    withAssetBurn: false,
  })
  const finalizedLenderVault = loadAssetAuthVaultProgram(buildFinalizedLenderVaultParams(params))
  const finalizedProtocolFeeVault = loadAssetAuthVaultProgram(
    buildFinalizedProtocolFeeVaultParams(params),
  )
  const finalizedLenderVaultCovHash = getProgramScriptHash(finalizedLenderVault)
  const finalizedProtocolFeeVaultCovHash = getProgramScriptHash(finalizedProtocolFeeVault)
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
    lenderVaultCovHash: getProgramScriptHash(activeLenderVault),
    finalizedLenderVaultCovHash,
    protocolFeeVaultCovHash: getProgramScriptHash(activeProtocolFeeVault),
    finalizedProtocolFeeVaultCovHash,
    principalOutputScriptHash: getProgramScriptHash(principalOutputAssetAuth),
  }
}

function getProgramScriptHash(program: SimplicityProgram): Bytes32 {
  return toBytes32(
    hexToBytes(buildCovenantSpendInfo(program).scriptPubkey.jet_sha256_hex()),
    'programScriptHash',
  )
}

export function buildLendingOfferSpendInfo(
  lendingProgram: SimplicityProgram,
  offerParameters: {
    principalAmount: Uint64
    principalInterestRate: Uint16
  },
  isActive = false,
): StateTaprootSpendInfo {
  const totalAmountToRepay = getTotalAmountToRepay(offerParameters)

  const isActiveSlot = new Uint8Array(32)
  isActiveSlot[31] = isActive ? 1 : 0

  const debtSlot = new Uint8Array(32)
  new DataView(debtSlot.buffer).setBigUint64(24, totalAmountToRepay, false)

  const numsKey = XOnlyPublicKey.fromString(UNSPENDABLE_TAPROOT_PUBKEY)

  return new StateTaprootBuilder()
    .addSimplicityLeaf(2, lendingProgram.cmr)
    .addDataLeaf(2, isActiveSlot)
    .addDataLeaf(1, debtSlot)
    .finalize(numsKey)
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
