import {
  SimplicityArguments,
  SimplicityProgram,
  SimplicityType,
  SimplicityTypedValue,
  SimplicityWitnessValues,
} from 'lwk_web'
import { sources } from 'virtual:simplicity-sources'

import { bytes32ToHex } from '@/utils/hex'
import type { Bytes32, Uint32, Uint64 } from '@/utils/uint'

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
  vaultAssetId: Bytes32
  keeperAuthAssetId: Bytes32
  supplierAuthAssetId: Bytes32
  keeperAuthAssetAmount: Uint64
  finalizedVaultCovHash: Bytes32
  isActive: boolean
  withKeeperAssetBurn: boolean
  withSupplierAssetBurn: boolean
}

export type AssetAuthVaultWitnessParams =
  | {
      branch: 'WithdrawAll'
      inputKeeperIndex: Uint32
      outputKeeperIndex: Uint32
    }
  | {
      branch: 'WithdrawPart'
      inputKeeperIndex: Uint32
      outputKeeperIndex: Uint32
      vaultOutputIndex: Uint32
      amountToWithdraw: Uint64
    }
  | {
      branch: 'Supply'
      inputSupplierIndex: Uint32
      outputSupplierIndex: Uint32
      vaultOutputIndex: Uint32
      amountToSupply: Uint64
    }
  | {
      branch: 'FinalSupply'
      inputSupplierIndex: Uint32
      outputSupplierIndex: Uint32
      finalizedVaultOutputIndex: Uint32
      amountToSupply: Uint64
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
      return `Left(Left((${params.inputKeeperIndex}, ${params.outputKeeperIndex})))`
    case 'WithdrawPart':
      return `Left(Right((${params.inputKeeperIndex}, ${params.outputKeeperIndex}, ${params.vaultOutputIndex}, ${params.amountToWithdraw})))`
    case 'Supply':
      return `Right(Left((${params.inputSupplierIndex}, ${params.outputSupplierIndex}, ${params.vaultOutputIndex}, ${params.amountToSupply})))`
    case 'FinalSupply':
      return `Right(Right((${params.inputSupplierIndex}, ${params.outputSupplierIndex}, ${params.finalizedVaultOutputIndex}, ${params.amountToSupply})))`
  }
}
