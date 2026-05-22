import {
  SimplicityArguments,
  SimplicityProgram,
  SimplicityTypedValue,
  SimplicityWitnessValues,
} from 'lwk_web'
import { sources } from 'virtual:simplicity-sources'

import { bytes32ToHex } from '@/utils/hex'

export function loadScriptAuthProgram(scriptHash: Uint8Array): SimplicityProgram {
  return SimplicityProgram.load(sources.script_auth, buildScriptAuthArguments(scriptHash))
}

// TODO: Generate typed argument/witness names from Simplicity source code
const ARGUMENTS = {
  SCRIPT_HASH: 'SCRIPT_HASH',
} as const

const WITNESS = {
  INPUT_SCRIPT_INDEX: 'INPUT_SCRIPT_INDEX',
} as const

export function buildScriptAuthArguments(scriptHash: Uint8Array): SimplicityArguments {
  return new SimplicityArguments().addValue(
    ARGUMENTS.SCRIPT_HASH,
    SimplicityTypedValue.fromU256Hex(bytes32ToHex(scriptHash)),
  )
}

export function buildScriptAuthWitness(inputScriptIndex: number): SimplicityWitnessValues {
  return new SimplicityWitnessValues().addValue(
    WITNESS.INPUT_SCRIPT_INDEX,
    SimplicityTypedValue.fromU32(inputScriptIndex),
  )
}
