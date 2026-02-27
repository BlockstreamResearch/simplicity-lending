/**
 * PreLock contract arguments for Finalize offer (PreLock creation).
 * Mirrors crates/contracts/src/pre_lock/build_arguments.rs.
 */

import { hexToBytes32 } from './hex'

/** 32-byte value (asset id, script hash, or pubkey). */
export type Bytes32 = Uint8Array

/** Lending parameters derived from Parameter NFTs. */
export interface LendingParams {
  collateralAmount: bigint
  principalAmount: bigint
  loanExpirationTime: number
  principalInterestRate: number
}

export interface PreLockArguments {
  collateralAssetId: Bytes32
  principalAssetId: Bytes32
  borrowerNftAssetId: Bytes32
  lenderNftAssetId: Bytes32
  firstParametersNftAssetId: Bytes32
  secondParametersNftAssetId: Bytes32
  lendingCovHash: Bytes32
  parametersNftOutputScriptHash: Bytes32
  borrowerNftOutputScriptHash: Bytes32
  principalOutputScriptHash: Bytes32
  borrowerPubKey: Bytes32
  collateralAmount: bigint
  principalAmount: bigint
  loanExpirationTime: number
  principalInterestRate: number
}

function ensureBytes32(value: string | Uint8Array): Uint8Array {
  if (value instanceof Uint8Array) {
    if (value.length !== 32) throw new Error('Expected 32-byte value')
    return value
  }
  return hexToBytes32(value)
}

export interface BuildPreLockArgumentsParams {
  collateralAssetId: string | Bytes32
  principalAssetId: string | Bytes32
  borrowerNftAssetId: string | Bytes32
  lenderNftAssetId: string | Bytes32
  firstParametersNftAssetId: string | Bytes32
  secondParametersNftAssetId: string | Bytes32
  lendingCovHash: string | Bytes32
  parametersNftOutputScriptHash: string | Bytes32
  borrowerNftOutputScriptHash: string | Bytes32
  principalOutputScriptHash: string | Bytes32
  borrowerPubKey: string | Bytes32
  lendingParams: LendingParams
}

/**
 * Build PreLockArguments for tx builder or backend.
 * In CLI, borrower_nft_output_script_hash and principal_output_script_hash both come from to_address (hash_script).
 */
export function buildPreLockArguments(params: BuildPreLockArgumentsParams): PreLockArguments {
  return {
    collateralAssetId: ensureBytes32(params.collateralAssetId),
    principalAssetId: ensureBytes32(params.principalAssetId),
    borrowerNftAssetId: ensureBytes32(params.borrowerNftAssetId),
    lenderNftAssetId: ensureBytes32(params.lenderNftAssetId),
    firstParametersNftAssetId: ensureBytes32(params.firstParametersNftAssetId),
    secondParametersNftAssetId: ensureBytes32(params.secondParametersNftAssetId),
    lendingCovHash: ensureBytes32(params.lendingCovHash),
    parametersNftOutputScriptHash: ensureBytes32(params.parametersNftOutputScriptHash),
    borrowerNftOutputScriptHash: ensureBytes32(params.borrowerNftOutputScriptHash),
    principalOutputScriptHash: ensureBytes32(params.principalOutputScriptHash),
    borrowerPubKey: ensureBytes32(params.borrowerPubKey),
    collateralAmount: params.lendingParams.collateralAmount,
    principalAmount: params.lendingParams.principalAmount,
    loanExpirationTime: params.lendingParams.loanExpirationTime,
    principalInterestRate: params.lendingParams.principalInterestRate,
  }
}
