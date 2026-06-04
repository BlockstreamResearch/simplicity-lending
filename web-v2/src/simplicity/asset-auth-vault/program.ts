import {
  SimplicityArguments,
  SimplicityProgram,
  SimplicityType,
  SimplicityTypedValue,
  SimplicityWitnessValues,
} from 'lwk_web'
import { sources } from 'virtual:simplicity-sources'

import { bytes32ToHex } from '@/utils/hex'
import { assertBytes32, assertUint32, assertUint64 } from '@/utils/uint'

const ARGUMENTS = {
  VAULT_ASSET_ID: 'VAULT_ASSET_ID',
  KEEPER_AUTH_ASSET_ID: 'KEEPER_AUTH_ASSET_ID',
  SUPPLIER_AUTH_ASSET_ID: 'SUPPLIER_AUTH_ASSET_ID',
  KEEPER_AUTH_ASSET_AMOUNT: 'KEEPER_AUTH_ASSET_AMOUNT',
  FINALIZED_VAULT_COV_HASH: 'FINALIZED_VAULT_COV_HASH',
  IS_ACTIVE: 'IS_ACTIVE',
  WITH_KEEPER_ASSET_BURN: 'WITH_KEEPER_ASSET_BURN',
  WITH_SUPPLIER_ASSET_BURN: 'WITH_SUPPLIER_ASSET_BURN',
} as const

const WITNESS = {
  PATH: 'PATH',
} as const

export interface AssetAuthVaultProgramParams {
  vaultAssetId: Uint8Array
  keeperAuthAssetId: Uint8Array
  supplierAuthAssetId: Uint8Array
  keeperAuthAssetAmount: bigint
  finalizedVaultCovHash: Uint8Array
  isActive: boolean
  withKeeperAssetBurn: boolean
  withSupplierAssetBurn: boolean
}

export type AssetAuthVaultWitnessParams =
  | {
      branch: 'WithdrawAll'
      inputKeeperIndex: number
      outputKeeperIndex: number
    }
  | {
      branch: 'WithdrawPart'
      inputKeeperIndex: number
      outputKeeperIndex: number
      vaultOutputIndex: number
      amountToWithdraw: bigint
    }
  | {
      branch: 'Supply'
      inputSupplierIndex: number
      outputSupplierIndex: number
      vaultOutputIndex: number
      amountToSupply: bigint
    }
  | {
      branch: 'FinalSupply'
      inputSupplierIndex: number
      outputSupplierIndex: number
      finalizedVaultOutputIndex: number
      amountToSupply: bigint
    }

export function loadAssetAuthVaultProgram(params: AssetAuthVaultProgramParams): SimplicityProgram {
  return SimplicityProgram.load(sources.asset_auth_vault, buildAssetAuthVaultArguments(params))
}

export function buildAssetAuthVaultArguments(
  params: AssetAuthVaultProgramParams,
): SimplicityArguments {
  const {
    finalizedVaultCovHash,
    isActive,
    keeperAuthAssetAmount,
    keeperAuthAssetId,
    supplierAuthAssetId,
    vaultAssetId,
    withKeeperAssetBurn,
    withSupplierAssetBurn,
  } = params

  assertBytes32(vaultAssetId, 'vaultAssetId')
  assertBytes32(keeperAuthAssetId, 'keeperAuthAssetId')
  assertBytes32(supplierAuthAssetId, 'supplierAuthAssetId')
  assertBytes32(finalizedVaultCovHash, 'finalizedVaultCovHash')

  assertUint64(keeperAuthAssetAmount, 'keeperAuthAssetAmount')

  return new SimplicityArguments()
    .addValue(
      ARGUMENTS.VAULT_ASSET_ID,
      SimplicityTypedValue.fromU256Hex(bytes32ToHex(vaultAssetId)),
    )
    .addValue(
      ARGUMENTS.KEEPER_AUTH_ASSET_ID,
      SimplicityTypedValue.fromU256Hex(bytes32ToHex(keeperAuthAssetId)),
    )
    .addValue(
      ARGUMENTS.SUPPLIER_AUTH_ASSET_ID,
      SimplicityTypedValue.fromU256Hex(bytes32ToHex(supplierAuthAssetId)),
    )
    .addValue(
      ARGUMENTS.KEEPER_AUTH_ASSET_AMOUNT,
      SimplicityTypedValue.fromU64(keeperAuthAssetAmount),
    )
    .addValue(
      ARGUMENTS.FINALIZED_VAULT_COV_HASH,
      SimplicityTypedValue.fromU256Hex(bytes32ToHex(finalizedVaultCovHash)),
    )
    .addValue(ARGUMENTS.IS_ACTIVE, SimplicityTypedValue.fromBoolean(isActive))
    .addValue(
      ARGUMENTS.WITH_KEEPER_ASSET_BURN,
      SimplicityTypedValue.fromBoolean(withKeeperAssetBurn),
    )
    .addValue(
      ARGUMENTS.WITH_SUPPLIER_ASSET_BURN,
      SimplicityTypedValue.fromBoolean(withSupplierAssetBurn),
    )
}

export function buildFinalizedAssetAuthVaultParams(
  params: Omit<AssetAuthVaultProgramParams, 'finalizedVaultCovHash' | 'isActive'>,
): AssetAuthVaultProgramParams {
  return {
    ...params,
    finalizedVaultCovHash: new Uint8Array(32),
    isActive: false,
  }
}

export function buildActiveAssetAuthVaultParams(
  finalizedParams: AssetAuthVaultProgramParams,
  finalizedVaultCovHash: Uint8Array,
): AssetAuthVaultProgramParams {
  return {
    ...finalizedParams,
    finalizedVaultCovHash,
    isActive: true,
  }
}

export function buildAssetAuthVaultWitness(
  params: AssetAuthVaultWitnessParams,
): SimplicityWitnessValues {
  const pathType = SimplicityType.fromString(
    'Either<Either<(u32, u32), (u32, u32, u32, u64)>, Either<(u32, u32, u32, u64), (u32, u32, u32, u64)>>',
  )

  return new SimplicityWitnessValues().addValue(
    WITNESS.PATH,
    SimplicityTypedValue.parse(buildAssetAuthVaultPathExpression(params), pathType),
  )
}

function buildAssetAuthVaultPathExpression(params: AssetAuthVaultWitnessParams): string {
  switch (params.branch) {
    case 'WithdrawAll':
      assertUint32(params.inputKeeperIndex, 'inputKeeperIndex')
      assertUint32(params.outputKeeperIndex, 'outputKeeperIndex')
      return `Left(Left((${params.inputKeeperIndex}, ${params.outputKeeperIndex})))`
    case 'WithdrawPart':
      assertUint32(params.inputKeeperIndex, 'inputKeeperIndex')
      assertUint32(params.outputKeeperIndex, 'outputKeeperIndex')
      assertUint32(params.vaultOutputIndex, 'vaultOutputIndex')
      assertUint64(params.amountToWithdraw, 'amountToWithdraw')
      return `Left(Right((${params.inputKeeperIndex}, ${params.outputKeeperIndex}, ${params.vaultOutputIndex}, ${params.amountToWithdraw})))`
    case 'Supply':
      assertUint32(params.inputSupplierIndex, 'inputSupplierIndex')
      assertUint32(params.outputSupplierIndex, 'outputSupplierIndex')
      assertUint32(params.vaultOutputIndex, 'vaultOutputIndex')
      assertUint64(params.amountToSupply, 'amountToSupply')
      return `Right(Left((${params.inputSupplierIndex}, ${params.outputSupplierIndex}, ${params.vaultOutputIndex}, ${params.amountToSupply})))`
    case 'FinalSupply':
      assertUint32(params.inputSupplierIndex, 'inputSupplierIndex')
      assertUint32(params.outputSupplierIndex, 'outputSupplierIndex')
      assertUint32(params.finalizedVaultOutputIndex, 'finalizedVaultOutputIndex')
      assertUint64(params.amountToSupply, 'amountToSupply')
      return `Right(Right((${params.inputSupplierIndex}, ${params.outputSupplierIndex}, ${params.finalizedVaultOutputIndex}, ${params.amountToSupply})))`
  }
}
