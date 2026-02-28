/**
 * AssetAuth covenant: buildArguments (for address / hash). Witness for unlock: INPUT_ASSET_INDEX, OUTPUT_ASSET_INDEX.
 */

import type { Lwk, LwkSimplicityArguments, LwkSimplicityWitnessValues } from '../lwk'
import { bytes32ToHex } from '../../utility/hex'

export function buildAssetAuthArguments(
  lwk: Lwk,
  params: { assetId: Uint8Array; assetAmount: number; withAssetBurn: boolean }
): LwkSimplicityArguments {
  const SimplicityArguments = lwk.SimplicityArguments
  const SimplicityTypedValue = lwk.SimplicityTypedValue
  return new SimplicityArguments()
    .addValue('ASSET_ID', SimplicityTypedValue.fromU256Hex(bytes32ToHex(params.assetId)))
    .addValue('ASSET_AMOUNT', SimplicityTypedValue.fromU64(BigInt(params.assetAmount)))
    .addValue('WITH_ASSET_BURN', SimplicityTypedValue.fromBoolean(params.withAssetBurn))
}

export interface BuildAssetAuthWitnessParams {
  /** Input index of the auth UTXO (1 in unlock: locked=0, auth=1, fee=2). */
  inputAssetIndex: number
  /** Output index of the auth burn output (1 in unlock: principal=0, auth burn=1). */
  outputAssetIndex: number
}

export function buildAssetAuthWitness(
  lwk: Lwk,
  params: BuildAssetAuthWitnessParams
): LwkSimplicityWitnessValues {
  const { SimplicityWitnessValues, SimplicityTypedValue } = lwk
  const w = new SimplicityWitnessValues()
  const next = w
    .addValue('INPUT_ASSET_INDEX', SimplicityTypedValue.fromU32(params.inputAssetIndex))
    .addValue('OUTPUT_ASSET_INDEX', SimplicityTypedValue.fromU32(params.outputAssetIndex))
  return (next as LwkSimplicityWitnessValues) ?? w
}
