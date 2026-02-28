/**
 * AssetAuth covenant: buildArguments (for address / hash). Witness not needed for current flows.
 */

import type { Lwk, LwkSimplicityArguments } from '../lwk'
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
