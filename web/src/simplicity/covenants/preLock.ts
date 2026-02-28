/**
 * PreLock covenant: buildArguments and buildWitness (PATH = LendingCreation | PreLockCancellation).
 */

import type { Lwk, LwkSimplicityArguments, LwkSimplicityWitnessValues } from '../lwk'
import type { PreLockArguments } from '../../utility/preLockArguments'
import { bytes32ToHex } from '../../utility/hex'

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

export type PreLockWitnessBranch = 'LendingCreation' | 'PreLockCancellation'

export interface BuildPreLockWitnessParams {
  branch: PreLockWitnessBranch
  cancellationSignatureHex?: string
}

/**
 * Build PreLock witness. PATH = Left(()) for LendingCreation, Right(signature) for PreLockCancellation.
 * Type PATH is Either<(), Signature>.
 */
export function buildPreLockWitness(
  lwk: Lwk,
  params: BuildPreLockWitnessParams
): LwkSimplicityWitnessValues {
  const { SimplicityType, SimplicityTypedValue, SimplicityWitnessValues } = lwk

  const pathType = new SimplicityType('Either<(), Signature>')

  const pathValue =
    params.branch === 'LendingCreation'
      ? new SimplicityTypedValue('Left(())', pathType)
      : new SimplicityTypedValue(`Right(${params.cancellationSignatureHex ?? ''})`, pathType)

  let witness = new SimplicityWitnessValues()
  const next = witness.addValue('PATH', pathValue)
  witness = next

  return witness
}
