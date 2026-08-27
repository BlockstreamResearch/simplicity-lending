import {
  SimplicityArguments,
  SimplicityProgram,
  SimplicityType,
  SimplicityTypedValue,
  SimplicityWitnessValues,
  StateTaprootBuilder,
  type StateTaprootSpendInfo,
  XOnlyPublicKey,
} from '@lilbonekit/lwk-web'
import { sources } from 'virtual:simplicity-sources'

import { loadAssetAuthProgram } from '@/simplicity/asset-auth/program'
import {
  type AssetAuthVaultProgramParams,
  getAssetAuthVaultTapleafHash,
  loadAssetAuthVaultProgram,
} from '@/simplicity/asset-auth-vault/program'
import { getProtocolFee, getTotalAmountToRepay, getTotalFee } from '@/simplicity/lending/utils'
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
  LENDER_VAULT_TAPLEAF_HASH: 'LENDER_VAULT_TAPLEAF_HASH',
  PROTOCOL_FEE_VAULT_TAPLEAF_HASH: 'PROTOCOL_FEE_VAULT_TAPLEAF_HASH',
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
  lenderVaultTapleafHash: Bytes32
  protocolFeeVaultTapleafHash: Bytes32
  lenderVaultSupplyGoal: Uint64
  protocolFeeVaultSupplyGoal: Uint64
  principalOutputScriptHash: Bytes32
}

export type LendingOfferWitnessParams =
  | { branch: 'OfferAcceptance' }
  | { branch: 'OfferCancellation' }
  | { branch: 'PartialRepayment'; currentDebt: Uint64; amountToRepay: Uint64 }
  | { branch: 'FullRepayment'; currentDebt: Uint64 }
  | { branch: 'Liquidation'; currentDebt: Uint64 }

export type LendingBranch = LendingOfferWitnessParams['branch']

// ExternalUtxo max-weight-to-satisfy for the Lending covenant input, per branch. Measured
// from real broadcast txs (program + CMR + control block + witness data bytes), plus a
// small margin. PartialRepayment isn't exercised by any hook yet, so it borrows the
// FullRepayment figure as a conservative placeholder until it's measured for real.
export const LENDING_MAX_WEIGHT_TO_SATISFY: Record<LendingBranch, number> = {
  OfferAcceptance: 3100,
  OfferCancellation: 3100,
  FullRepayment: 3900,
  Liquidation: 2800,

  // Not tested
  PartialRepayment: 3900,
}

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
      ARGUMENTS.LENDER_VAULT_TAPLEAF_HASH,
      SimplicityTypedValue.fromU256Hex(bytes32ToHex(params.lenderVaultTapleafHash)),
    )
    .addValue(
      ARGUMENTS.PROTOCOL_FEE_VAULT_TAPLEAF_HASH,
      SimplicityTypedValue.fromU256Hex(bytes32ToHex(params.protocolFeeVaultTapleafHash)),
    )
    .addValue(
      ARGUMENTS.PRINCIPAL_OUTPUT_SCRIPT_HASH,
      SimplicityTypedValue.fromU256Hex(bytes32ToHex(params.principalOutputScriptHash)),
    )
}

function buildLenderVaultParams(
  params: Pick<
    LendingOfferProgramParams,
    'principalAssetId' | 'lenderNftAssetId' | 'borrowerNftAssetId'
  >,
  supplyGoal: Uint64,
): AssetAuthVaultProgramParams {
  return {
    vaultAssetId: params.principalAssetId,
    keeperAuthAssetId: params.lenderNftAssetId,
    supplierAuthAssetId: params.borrowerNftAssetId,
    supplyGoal,
    withKeeperAssetBurn: true,
    withSupplierAssetBurn: true,
  }
}

function buildProtocolFeeVaultParams(
  params: Pick<
    LendingOfferProgramParams,
    'principalAssetId' | 'protocolFeeKeeperAssetId' | 'borrowerNftAssetId'
  >,
  supplyGoal: Uint64,
): AssetAuthVaultProgramParams {
  return {
    vaultAssetId: params.principalAssetId,
    keeperAuthAssetId: params.protocolFeeKeeperAssetId,
    supplierAuthAssetId: params.borrowerNftAssetId,
    supplyGoal,
    withKeeperAssetBurn: false,
    withSupplierAssetBurn: false,
  }
}

export function buildDerivedLendingOfferProgramParams(
  params: Omit<
    LendingOfferProgramParams,
    | 'lenderVaultTapleafHash'
    | 'protocolFeeVaultTapleafHash'
    | 'lenderVaultSupplyGoal'
    | 'protocolFeeVaultSupplyGoal'
    | 'principalOutputScriptHash'
  >,
): LendingOfferProgramParams {
  const principalOutputAssetAuth = loadAssetAuthProgram({
    assetId: params.borrowerNftAssetId,
    assetAmount: toUint64(1n),
    withAssetBurn: false,
  })

  const totalAmountToRepay = getTotalAmountToRepay(params.offerParameters)
  const totalProtocolFee = getProtocolFee(getTotalFee(params.offerParameters))
  const lenderVaultSupplyGoal = toUint64(
    totalAmountToRepay - totalProtocolFee,
    'lenderVaultSupplyGoal',
  )
  const protocolFeeVaultSupplyGoal = totalProtocolFee

  const lenderVaultProgram = loadAssetAuthVaultProgram(
    buildLenderVaultParams(params, lenderVaultSupplyGoal),
  )
  const protocolFeeVaultProgram = loadAssetAuthVaultProgram(
    buildProtocolFeeVaultParams(params, protocolFeeVaultSupplyGoal),
  )

  return {
    ...params,
    lenderVaultTapleafHash: getAssetAuthVaultTapleafHash(lenderVaultProgram),
    protocolFeeVaultTapleafHash: getAssetAuthVaultTapleafHash(protocolFeeVaultProgram),
    lenderVaultSupplyGoal,
    protocolFeeVaultSupplyGoal,
    principalOutputScriptHash: getProgramScriptHash(principalOutputAssetAuth),
  }
}

export function buildLenderVaultProgram(
  derivedParams: LendingOfferProgramParams,
): SimplicityProgram {
  return loadAssetAuthVaultProgram(
    buildLenderVaultParams(derivedParams, derivedParams.lenderVaultSupplyGoal),
  )
}

export function buildProtocolFeeVaultProgram(
  derivedParams: LendingOfferProgramParams,
): SimplicityProgram {
  return loadAssetAuthVaultProgram(
    buildProtocolFeeVaultParams(derivedParams, derivedParams.protocolFeeVaultSupplyGoal),
  )
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
  currentDebt?: Uint64,
): StateTaprootSpendInfo {
  const debt = currentDebt ?? getTotalAmountToRepay(offerParameters)

  const isActiveSlot = new Uint8Array(32)
  isActiveSlot[31] = isActive ? 1 : 0

  const debtSlot = new Uint8Array(32)
  new DataView(debtSlot.buffer).setBigUint64(24, debt, false)

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
