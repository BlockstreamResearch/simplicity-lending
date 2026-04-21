/**
 * Lending covenant: buildArguments (for address / hash) and buildWitness.
 */

import type { Lwk, LwkSimplicityArguments, LwkSimplicityWitnessValues } from '../lwk'
import type { LendingParams } from '../../utility/preLockArguments'
import { bytes32ToHex } from '../../utility/hex'

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

export type LendingWitnessBranch = 'LoanRepayment' | 'LoanLiquidation'

export interface BuildLendingWitnessParams {
  branch: LendingWitnessBranch
}

/**
 * Build Lending witness. PATH = Left(()) for LoanRepayment, Right(()) for LoanLiquidation.
 * Type PATH is Either<(), ()>.
 */
export function buildLendingWitness(
  lwk: Lwk,
  params: BuildLendingWitnessParams
): LwkSimplicityWitnessValues {
  const { SimplicityType, SimplicityTypedValue, SimplicityWitnessValues } = lwk

  const pathType = SimplicityType.fromString('Either<(), ()>')
  const branchStr = params.branch === 'LoanRepayment' ? 'Left(())' : 'Right(())'
  const pathValue = SimplicityTypedValue.parse(branchStr, pathType)

  let witness = new SimplicityWitnessValues()
  witness = witness.addValue('PATH', pathValue)

  return witness
}
