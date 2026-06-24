import {
  SimplicityArguments,
  SimplicityProgram,
  SimplicityType,
  SimplicityTypedValue,
  SimplicityWitnessValues,
} from '@lilbonekit/lwk-web'
import { sources } from 'virtual:simplicity-sources'

import type { Uint8, Uint32, Uint64 } from '@/utils/uint'

const ARGUMENTS = {
  ISSUING_UTXOS_COUNT: 'ISSUING_UTXOS_COUNT',
  REISSUANCE_FLAGS: 'REISSUANCE_FLAGS',
} as const

const WITNESS = {
  PATH: 'PATH',
} as const

export interface IssuanceFactoryProgramParams {
  issuingUtxosCount: Uint8
  reissuanceFlags: Uint64
}

export interface IssuanceFactoryWitnessParams {
  branch: 'IssueAssets' | 'RemoveFactory'
  outputIndex: Uint32
}

export type IssuanceFactoryBranch = IssuanceFactoryWitnessParams['branch']

// ExternalUtxo max-weight-to-satisfy for the IssuanceFactory covenant input, per branch.
// IssueAssets is measured from a real broadcast tx (3243 bytes, plus margin). RemoveFactory
// isn't wired up yet (see useBorrowerAccount.ts removeBorrowerAccount), so it keeps the old
// conservative placeholder until measured for real.
export const ISSUANCE_FACTORY_MAX_WEIGHT_TO_SATISFY: Record<IssuanceFactoryBranch, number> = {
  IssueAssets: 3500,

  // Not tested
  RemoveFactory: 30_000,
}

export function loadIssuanceFactoryProgram(
  params: IssuanceFactoryProgramParams,
): SimplicityProgram {
  return SimplicityProgram.load(sources.issuance_factory, buildIssuanceFactoryArguments(params))
}

export function buildIssuanceFactoryArguments(
  params: IssuanceFactoryProgramParams,
): SimplicityArguments {
  return new SimplicityArguments()
    .addValue(ARGUMENTS.ISSUING_UTXOS_COUNT, SimplicityTypedValue.fromU8(params.issuingUtxosCount))
    .addValue(ARGUMENTS.REISSUANCE_FLAGS, SimplicityTypedValue.fromU64(params.reissuanceFlags))
}

export function buildIssuanceFactoryWitness(
  params: IssuanceFactoryWitnessParams,
): SimplicityWitnessValues {
  const pathType = SimplicityType.fromString('Either<u32, u32>')
  const pathExpression =
    params.branch === 'IssueAssets' ? `Left(${params.outputIndex})` : `Right(${params.outputIndex})`

  return new SimplicityWitnessValues().addValue(
    WITNESS.PATH,
    SimplicityTypedValue.parse(pathExpression, pathType),
  )
}
