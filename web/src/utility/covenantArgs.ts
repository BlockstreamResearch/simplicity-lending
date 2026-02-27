/**
 * Build LWK SimplicityArguments for covenants: AssetAuth, ScriptAuth, Lending, PreLock.
 * Witness names and types match crates/contracts * build_arguments.rs.
 */

import type { Lwk, LwkSimplicityArguments } from '../simplicity'
import type { LendingParams } from './preLockArguments'
import type { PreLockArguments } from './preLockArguments'
import { bytes32ToHex } from './hex'

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

export function buildScriptAuthArguments(
  lwk: Lwk,
  params: { scriptHash: Uint8Array }
): LwkSimplicityArguments {
  const SimplicityArguments = lwk.SimplicityArguments
  const SimplicityTypedValue = lwk.SimplicityTypedValue
  return new SimplicityArguments().addValue(
    'SCRIPT_HASH',
    SimplicityTypedValue.fromU256Hex(bytes32ToHex(params.scriptHash))
  )
}

export function buildLendingArguments(
  lwk: Lwk,
  params: {
    collateralAssetId: Uint8Array
    principalAssetId: Uint8Array
    borrowerNftAssetId: Uint8Array
    lenderNftAssetId: Uint8Array
    firstParametersNftAssetId: Uint8Array
    secondParametersNftAssetId: Uint8Array
    lenderPrincipalCovHash: Uint8Array
    lendingParams: LendingParams
  }
): LwkSimplicityArguments {
  const SimplicityArguments = lwk.SimplicityArguments
  const SimplicityTypedValue = lwk.SimplicityTypedValue
  const L = params.lendingParams
  return new SimplicityArguments()
    .addValue(
      'COLLATERAL_ASSET_ID',
      SimplicityTypedValue.fromU256Hex(bytes32ToHex(params.collateralAssetId))
    )
    .addValue(
      'PRINCIPAL_ASSET_ID',
      SimplicityTypedValue.fromU256Hex(bytes32ToHex(params.principalAssetId))
    )
    .addValue(
      'BORROWER_NFT_ASSET_ID',
      SimplicityTypedValue.fromU256Hex(bytes32ToHex(params.borrowerNftAssetId))
    )
    .addValue(
      'LENDER_NFT_ASSET_ID',
      SimplicityTypedValue.fromU256Hex(bytes32ToHex(params.lenderNftAssetId))
    )
    .addValue(
      'FIRST_PARAMETERS_NFT_ASSET_ID',
      SimplicityTypedValue.fromU256Hex(bytes32ToHex(params.firstParametersNftAssetId))
    )
    .addValue(
      'SECOND_PARAMETERS_NFT_ASSET_ID',
      SimplicityTypedValue.fromU256Hex(bytes32ToHex(params.secondParametersNftAssetId))
    )
    .addValue(
      'LENDER_PRINCIPAL_COV_HASH',
      SimplicityTypedValue.fromU256Hex(bytes32ToHex(params.lenderPrincipalCovHash))
    )
    .addValue('COLLATERAL_AMOUNT', SimplicityTypedValue.fromU64(L.collateralAmount))
    .addValue('PRINCIPAL_AMOUNT', SimplicityTypedValue.fromU64(L.principalAmount))
    .addValue('LOAN_EXPIRATION_TIME', SimplicityTypedValue.fromU32(L.loanExpirationTime))
    .addValue('PRINCIPAL_INTEREST_RATE', SimplicityTypedValue.fromU16(L.principalInterestRate))
}

export function buildPreLockArguments(lwk: Lwk, args: PreLockArguments): LwkSimplicityArguments {
  const SimplicityArguments = lwk.SimplicityArguments
  const SimplicityTypedValue = lwk.SimplicityTypedValue
  return new SimplicityArguments()
    .addValue(
      'COLLATERAL_ASSET_ID',
      SimplicityTypedValue.fromU256Hex(bytes32ToHex(args.collateralAssetId))
    )
    .addValue(
      'PRINCIPAL_ASSET_ID',
      SimplicityTypedValue.fromU256Hex(bytes32ToHex(args.principalAssetId))
    )
    .addValue(
      'BORROWER_NFT_ASSET_ID',
      SimplicityTypedValue.fromU256Hex(bytes32ToHex(args.borrowerNftAssetId))
    )
    .addValue(
      'LENDER_NFT_ASSET_ID',
      SimplicityTypedValue.fromU256Hex(bytes32ToHex(args.lenderNftAssetId))
    )
    .addValue(
      'FIRST_PARAMETERS_NFT_ASSET_ID',
      SimplicityTypedValue.fromU256Hex(bytes32ToHex(args.firstParametersNftAssetId))
    )
    .addValue(
      'SECOND_PARAMETERS_NFT_ASSET_ID',
      SimplicityTypedValue.fromU256Hex(bytes32ToHex(args.secondParametersNftAssetId))
    )
    .addValue(
      'LENDING_COV_HASH',
      SimplicityTypedValue.fromU256Hex(bytes32ToHex(args.lendingCovHash))
    )
    .addValue(
      'PARAMETERS_NFT_OUTPUT_SCRIPT_HASH',
      SimplicityTypedValue.fromU256Hex(bytes32ToHex(args.parametersNftOutputScriptHash))
    )
    .addValue(
      'BORROWER_NFT_OUTPUT_SCRIPT_HASH',
      SimplicityTypedValue.fromU256Hex(bytes32ToHex(args.borrowerNftOutputScriptHash))
    )
    .addValue(
      'PRINCIPAL_OUTPUT_SCRIPT_HASH',
      SimplicityTypedValue.fromU256Hex(bytes32ToHex(args.principalOutputScriptHash))
    )
    .addValue(
      'BORROWER_PUB_KEY',
      SimplicityTypedValue.fromU256Hex(bytes32ToHex(args.borrowerPubKey))
    )
    .addValue('COLLATERAL_AMOUNT', SimplicityTypedValue.fromU64(args.collateralAmount))
    .addValue('PRINCIPAL_AMOUNT', SimplicityTypedValue.fromU64(args.principalAmount))
    .addValue('LOAN_EXPIRATION_TIME', SimplicityTypedValue.fromU32(args.loanExpirationTime))
    .addValue('PRINCIPAL_INTEREST_RATE', SimplicityTypedValue.fromU16(args.principalInterestRate))
}
