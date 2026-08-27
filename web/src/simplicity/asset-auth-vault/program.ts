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

import { UNSPENDABLE_TAPROOT_PUBKEY } from '@/simplicity/taproot'
import { bytes32ToHex } from '@/utils/hex'
import { type Bytes32, toBytes32, type Uint32, type Uint64 } from '@/utils/uint'

const ARGUMENTS = {
  VAULT_ASSET_ID: 'VAULT_ASSET_ID',
  KEEPER_AUTH_ASSET_ID: 'KEEPER_AUTH_ASSET_ID',
  SUPPLIER_AUTH_ASSET_ID: 'SUPPLIER_AUTH_ASSET_ID',
  SUPPLY_GOAL: 'SUPPLY_GOAL',
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
  supplyGoal: Uint64
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
      alreadySupplied: Uint64
      amountToWithdraw: Uint64
    }
  | {
      branch: 'Supply'
      inputSupplierIndex: Uint32
      outputSupplierIndex: Uint32
      vaultOutputIndex: Uint32
      alreadySupplied: Uint64
      amountToSupply: Uint64
    }
  | {
      branch: 'FinalSupply'
      inputSupplierIndex: Uint32
      outputSupplierIndex: Uint32
      finalizedVaultOutputIndex: Uint32
      alreadySupplied: Uint64
    }

export type AssetAuthVaultBranch = AssetAuthVaultWitnessParams['branch']

// ExternalUtxo max-weight-to-satisfy for the AssetAuthVault covenant input, per branch.
// WithdrawAll is measured from a real broadcast tx (1328 bytes, plus margin). The other
// branches aren't exercised by any hook yet, so they keep a conservative placeholder
// until measured for real.
export const ASSET_AUTH_VAULT_MAX_WEIGHT_TO_SATISFY: Record<AssetAuthVaultBranch, number> = {
  WithdrawAll: 1500,

  // Not tested
  WithdrawPart: 30_000,
  Supply: 30_000,
  FinalSupply: 30_000,
}

export function loadAssetAuthVaultProgram(params: AssetAuthVaultProgramParams): SimplicityProgram {
  return SimplicityProgram.load(sources.asset_auth_vault, buildAssetAuthVaultArguments(params))
}

export function buildAssetAuthVaultArguments(
  params: AssetAuthVaultProgramParams,
): SimplicityArguments {
  const {
    keeperAuthAssetId,
    supplierAuthAssetId,
    supplyGoal,
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
    .addValue(ARGUMENTS.SUPPLY_GOAL, SimplicityTypedValue.fromU64(supplyGoal))
    .addValue(
      ARGUMENTS.WITH_KEEPER_ASSET_BURN,
      SimplicityTypedValue.fromBoolean(withKeeperAssetBurn),
    )
    .addValue(
      ARGUMENTS.WITH_SUPPLIER_ASSET_BURN,
      SimplicityTypedValue.fromBoolean(withSupplierAssetBurn),
    )
}

export function buildAssetAuthVaultSpendInfo(
  program: SimplicityProgram,
  isActive: boolean,
  alreadySupplied: Uint64,
): StateTaprootSpendInfo {
  const isActiveSlot = new Uint8Array(32)
  isActiveSlot[31] = isActive ? 1 : 0

  const alreadySuppliedSlot = new Uint8Array(32)
  new DataView(alreadySuppliedSlot.buffer).setBigUint64(24, alreadySupplied, false)

  const numsKey = XOnlyPublicKey.fromString(UNSPENDABLE_TAPROOT_PUBKEY)

  return new StateTaprootBuilder()
    .addSimplicityLeaf(2, program.cmr)
    .addDataLeaf(2, isActiveSlot)
    .addDataLeaf(1, alreadySuppliedSlot)
    .finalize(numsKey)
}

export function getAssetAuthVaultTapleafHash(program: SimplicityProgram): Bytes32 {
  const numsKey = XOnlyPublicKey.fromString(UNSPENDABLE_TAPROOT_PUBKEY)
  const spendInfo = new StateTaprootBuilder().addSimplicityLeaf(0, program.cmr).finalize(numsKey)
  const merkleRoot = spendInfo.merkleRoot
  if (!merkleRoot) throw new Error('Missing merkle root for single-leaf AssetAuthVault program')

  return toBytes32(merkleRoot, 'assetAuthVaultTapleafHash')
}

export function buildAssetAuthVaultWitness(
  params: AssetAuthVaultWitnessParams,
): SimplicityWitnessValues {
  const pathType = SimplicityType.fromString(
    'Either<Either<(u32, u32), (u32, u32, u32, u64, u64)>, Either<(u32, u32, u32, u64, u64), (u32, u32, u32, u64)>>',
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
      return `Left(Right((${params.inputKeeperIndex}, ${params.outputKeeperIndex}, ${params.vaultOutputIndex}, ${params.alreadySupplied}, ${params.amountToWithdraw})))`
    case 'Supply':
      return `Right(Left((${params.inputSupplierIndex}, ${params.outputSupplierIndex}, ${params.vaultOutputIndex}, ${params.alreadySupplied}, ${params.amountToSupply})))`
    case 'FinalSupply':
      return `Right(Right((${params.inputSupplierIndex}, ${params.outputSupplierIndex}, ${params.finalizedVaultOutputIndex}, ${params.alreadySupplied})))`
  }
}
