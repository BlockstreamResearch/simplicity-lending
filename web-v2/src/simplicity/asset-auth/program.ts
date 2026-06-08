import {
  SimplicityArguments,
  SimplicityProgram,
  SimplicityTypedValue,
  SimplicityWitnessValues,
} from 'lwk_web'
import { sources } from 'virtual:simplicity-sources'

import { bytes32ToHex } from '@/utils/hex'
import type { Bytes32, Uint32, Uint64 } from '@/utils/uint'

const ARGUMENTS = {
  ASSET_ID: 'ASSET_ID',
  ASSET_AMOUNT: 'ASSET_AMOUNT',
  WITH_ASSET_BURN: 'WITH_ASSET_BURN',
} as const

const WITNESS = {
  INPUT_ASSET_INDEX: 'INPUT_ASSET_INDEX',
  OUTPUT_ASSET_INDEX: 'OUTPUT_ASSET_INDEX',
} as const

export interface AssetAuthProgramParams {
  assetId: Bytes32
  assetAmount: Uint64
  withAssetBurn: boolean
}

export interface AssetAuthWitnessParams {
  inputAssetIndex: Uint32
  outputAssetIndex: Uint32
}

export function loadAssetAuthProgram(params: AssetAuthProgramParams): SimplicityProgram {
  return SimplicityProgram.load(sources.asset_auth, buildAssetAuthArguments(params))
}

export function buildAssetAuthArguments(params: AssetAuthProgramParams): SimplicityArguments {
  return new SimplicityArguments()
    .addValue(ARGUMENTS.ASSET_ID, SimplicityTypedValue.fromU256Hex(bytes32ToHex(params.assetId)))
    .addValue(ARGUMENTS.ASSET_AMOUNT, SimplicityTypedValue.fromU64(params.assetAmount))
    .addValue(ARGUMENTS.WITH_ASSET_BURN, SimplicityTypedValue.fromBoolean(params.withAssetBurn))
}

export function buildAssetAuthWitness(params: AssetAuthWitnessParams): SimplicityWitnessValues {
  return new SimplicityWitnessValues()
    .addValue(WITNESS.INPUT_ASSET_INDEX, SimplicityTypedValue.fromU32(params.inputAssetIndex))
    .addValue(WITNESS.OUTPUT_ASSET_INDEX, SimplicityTypedValue.fromU32(params.outputAssetIndex))
}
