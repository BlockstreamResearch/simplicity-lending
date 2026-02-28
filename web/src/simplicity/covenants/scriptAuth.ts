/**
 * ScriptAuth covenant: buildArguments and buildWitness (INPUT_SCRIPT_INDEX).
 */

import type { Lwk, LwkSimplicityArguments, LwkSimplicityWitnessValues } from '../lwk'
import { bytes32ToHex } from '../../utility/hex'

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

export function buildScriptAuthWitness(
  lwk: Lwk,
  params: { inputScriptIndex: number }
): LwkSimplicityWitnessValues {
  const SimplicityWitnessValues = lwk.SimplicityWitnessValues
  const SimplicityTypedValue = lwk.SimplicityTypedValue
  const w = new SimplicityWitnessValues()
  const next = w.addValue('INPUT_SCRIPT_INDEX', SimplicityTypedValue.fromU32(params.inputScriptIndex))
  return (next as LwkSimplicityWitnessValues) ?? w
}
