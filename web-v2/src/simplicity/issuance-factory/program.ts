import {
  SimplicityArguments,
  SimplicityProgram,
  SimplicityType,
  SimplicityTypedValue,
  SimplicityWitnessValues,
} from 'lwk_web'
import { sources } from 'virtual:simplicity-sources'

import { bytes32ToHex, isHexStringOfByteLength, normalizeHex } from '@/utils/hex'
import { isUint8, isUint32, isUint64 } from '@/utils/uint'

const ARGUMENTS = {
  ISSUING_UTXOS_COUNT: 'ISSUING_UTXOS_COUNT',
  REISSUANCE_FLAGS: 'REISSUANCE_FLAGS',
  FACTORY_OWNER_PUBKEY: 'FACTORY_OWNER_PUBKEY',
} as const

const WITNESS = {
  PATH: 'PATH',
} as const

export interface IssuanceFactoryProgramParams {
  issuingUtxosCount: number
  reissuanceFlags: bigint
  factoryOwnerPubkey: Uint8Array
}

export interface IssuanceFactoryWitnessParams {
  branch: 'IssueAssets' | 'RemoveFactory'
  outputIndex: number
  ownerSignatureHex: string
}

export function loadIssuanceFactoryProgram(
  params: IssuanceFactoryProgramParams,
): SimplicityProgram {
  return SimplicityProgram.load(sources.issuance_factory, buildIssuanceFactoryArguments(params))
}

export function buildIssuanceFactoryArguments(
  params: IssuanceFactoryProgramParams,
): SimplicityArguments {
  if (!isUint8(params.issuingUtxosCount)) {
    throw new Error('issuingUtxosCount must fit into u8')
  }
  if (!isUint64(params.reissuanceFlags)) {
    throw new Error('reissuanceFlags must fit into u64')
  }
  if (params.factoryOwnerPubkey.length !== 32) {
    throw new Error('factoryOwnerPubkey must be a 32-byte x-only public key')
  }

  return new SimplicityArguments()
    .addValue(ARGUMENTS.ISSUING_UTXOS_COUNT, SimplicityTypedValue.fromU8(params.issuingUtxosCount))
    .addValue(ARGUMENTS.REISSUANCE_FLAGS, SimplicityTypedValue.fromU64(params.reissuanceFlags))
    .addValue(
      ARGUMENTS.FACTORY_OWNER_PUBKEY,
      SimplicityTypedValue.fromU256Hex(bytes32ToHex(params.factoryOwnerPubkey)),
    )
}

export function buildIssuanceFactoryWitness(
  params: IssuanceFactoryWitnessParams,
): SimplicityWitnessValues {
  if (!isUint32(params.outputIndex)) {
    throw new Error('outputIndex must fit into u32')
  }

  const pathType = SimplicityType.fromString('Either<(u32, Signature), (u32, Signature)>')
  const ownerSignatureHex = normalizeHex(params.ownerSignatureHex)
  if (!isHexStringOfByteLength(ownerSignatureHex, 64)) {
    throw new Error('ownerSignatureHex must be a 64-byte Schnorr signature hex string')
  }

  const pathParams = `(${params.outputIndex}, 0x${ownerSignatureHex})`
  const pathExpression =
    params.branch === 'IssueAssets' ? `Left(${pathParams})` : `Right(${pathParams})`

  return new SimplicityWitnessValues().addValue(
    WITNESS.PATH,
    SimplicityTypedValue.parse(pathExpression, pathType),
  )
}
