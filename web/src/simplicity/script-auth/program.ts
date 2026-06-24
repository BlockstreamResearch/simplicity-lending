import {
  SimplicityArguments,
  SimplicityProgram,
  SimplicityTypedValue,
  SimplicityWitnessValues,
} from 'lwk_web'
import { sources } from 'virtual:simplicity-sources'

import { bytes32ToHex } from '@/utils/hex'
import type { Bytes32, Uint32 } from '@/utils/uint'

const ARGUMENTS = {
  SCRIPT_HASH: 'SCRIPT_HASH',
} as const

const WITNESS = {
  INPUT_SCRIPT_INDEX: 'INPUT_SCRIPT_INDEX',
} as const

// ExternalUtxo max-weight-to-satisfy for the ScriptAuth covenant input. Measured from real
// broadcast txs (program + CMR + control block + witness data = 331 bytes), plus margin.
export const SCRIPT_AUTH_MAX_WEIGHT_TO_SATISFY = 400

export function loadScriptAuthProgram(scriptHash: Bytes32): SimplicityProgram {
  return SimplicityProgram.load(sources.script_auth, buildScriptAuthArguments(scriptHash))
}

export function buildScriptAuthArguments(scriptHash: Bytes32): SimplicityArguments {
  return new SimplicityArguments().addValue(
    ARGUMENTS.SCRIPT_HASH,
    SimplicityTypedValue.fromU256Hex(bytes32ToHex(scriptHash)),
  )
}

export function buildScriptAuthWitness(inputScriptIndex: Uint32): SimplicityWitnessValues {
  return new SimplicityWitnessValues().addValue(
    WITNESS.INPUT_SCRIPT_INDEX,
    SimplicityTypedValue.fromU32(inputScriptIndex),
  )
}
