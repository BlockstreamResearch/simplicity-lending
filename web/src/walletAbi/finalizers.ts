import { createSimfFinalizer } from 'wallet-abi-sdk-alpha'
import type { FinalizerSpec } from 'wallet-abi-sdk-alpha/schema'
import { getSource, getLwk } from '../simplicity'
import {
  buildAssetAuthArguments,
  buildAssetAuthWitness,
  buildLendingArguments,
  buildLendingWitness,
  buildScriptAuthArguments,
  buildScriptAuthWitness,
} from '../simplicity/covenants'
import type { LendingParams, PreLockArguments } from '../utility/preLockArguments'
import { buildPreLockArguments } from '../simplicity/covenants/preLock'

const ZERO_SIGNATURE_HEX = '00'.repeat(64)

async function serializeArguments(
  resolved: ReturnType<typeof buildScriptAuthArguments>
): Promise<number[]> {
  const lwk = await getLwk()
  return Array.from(lwk.walletAbiSerializeArguments(resolved, {}))
}

async function serializeWitness(
  resolved: ReturnType<typeof buildScriptAuthWitness>,
  runtimeArguments: unknown[]
): Promise<number[]> {
  const lwk = await getLwk()
  return Array.from(lwk.walletAbiSerializeWitness(resolved, runtimeArguments))
}

async function buildPreLockCreationResolvedWitness() {
  const lwk = await getLwk()
  const pathType = new lwk.SimplicityType('Either<(), ()>')
  return new lwk.SimplicityWitnessValues()
    .addValue('PATH', new lwk.SimplicityTypedValue('Left(())', pathType))
    .addValue(
      'CANCELLATION_SIGNATURE',
      lwk.SimplicityTypedValue.fromByteArrayHex(ZERO_SIGNATURE_HEX)
    )
}

async function buildPreLockCancellationResolvedWitness() {
  const lwk = await getLwk()
  const pathType = new lwk.SimplicityType('Either<(), ()>')
  return new lwk.SimplicityWitnessValues().addValue(
    'PATH',
    new lwk.SimplicityTypedValue('Right(())', pathType)
  )
}

export async function buildScriptAuthFinalizer(scriptHash: Uint8Array): Promise<FinalizerSpec> {
  const lwk = await getLwk()
  const arguments_ = buildScriptAuthArguments(lwk, { scriptHash })
  const witness = buildScriptAuthWitness(lwk, { inputScriptIndex: 0 })
  return createSimfFinalizer({
    source_simf: getSource('script_auth'),
    arguments: await serializeArguments(arguments_),
    witness: await serializeWitness(witness, []),
  })
}

export async function buildAssetAuthFinalizer(params: {
  assetId: Uint8Array
  assetAmount: number
  withAssetBurn: boolean
  inputAssetIndex: number
  outputAssetIndex: number
}): Promise<FinalizerSpec> {
  const lwk = await getLwk()
  const arguments_ = buildAssetAuthArguments(lwk, {
    assetId: params.assetId,
    assetAmount: params.assetAmount,
    withAssetBurn: params.withAssetBurn,
  })
  const witness = buildAssetAuthWitness(lwk, {
    inputAssetIndex: params.inputAssetIndex,
    outputAssetIndex: params.outputAssetIndex,
  })
  return createSimfFinalizer({
    source_simf: getSource('asset_auth'),
    arguments: await serializeArguments(arguments_),
    witness: await serializeWitness(witness, []),
  })
}

export async function buildLendingFinalizer(params: {
  collateralAssetId: Uint8Array
  principalAssetId: Uint8Array
  borrowerNftAssetId: Uint8Array
  lenderNftAssetId: Uint8Array
  firstParametersNftAssetId: Uint8Array
  secondParametersNftAssetId: Uint8Array
  lenderPrincipalCovHash: Uint8Array
  lendingParams: LendingParams
  branch: 'LoanRepayment' | 'LoanLiquidation'
}): Promise<FinalizerSpec> {
  const lwk = await getLwk()
  const arguments_ = buildLendingArguments(lwk, params)
  const witness = buildLendingWitness(lwk, { branch: params.branch })
  return createSimfFinalizer({
    source_simf: getSource('lending'),
    arguments: await serializeArguments(arguments_),
    witness: await serializeWitness(witness, []),
  })
}

export async function buildPreLockCreationFinalizer(
  arguments_: PreLockArguments
): Promise<FinalizerSpec> {
  const lwk = await getLwk()
  const resolvedArguments = buildPreLockArguments(lwk, arguments_)
  const resolvedWitness = await buildPreLockCreationResolvedWitness()
  return createSimfFinalizer({
    source_simf: getSource('pre_lock'),
    arguments: await serializeArguments(resolvedArguments),
    witness: await serializeWitness(resolvedWitness, []),
  })
}

export async function buildPreLockCancellationFinalizer(params: {
  arguments: PreLockArguments
  signingXOnlyPubkey: string
}): Promise<FinalizerSpec> {
  const lwk = await getLwk()
  const resolvedArguments = buildPreLockArguments(lwk, params.arguments)
  const resolvedWitness = await buildPreLockCancellationResolvedWitness()
  return createSimfFinalizer({
    source_simf: getSource('pre_lock'),
    arguments: await serializeArguments(resolvedArguments),
    witness: await serializeWitness(resolvedWitness, [
      {
        sig_hash_all: {
          name: 'CANCELLATION_SIGNATURE',
          public_key: params.signingXOnlyPubkey,
        },
      },
    ]),
  })
}
