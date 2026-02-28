/**
 * P2PK covenant: buildArguments and buildWitness (SIGNATURE).
 */

import type { Lwk, LwkSimplicityArguments, LwkSimplicityWitnessValues } from '../lwk'

export function buildP2pkArguments(lwk: Lwk, params: { publicKeyHex: string }): LwkSimplicityArguments {
  const SimplicityArguments = lwk.SimplicityArguments
  const SimplicityTypedValue = lwk.SimplicityTypedValue
  return new SimplicityArguments().addValue(
    'PUBLIC_KEY',
    SimplicityTypedValue.fromU256Hex(params.publicKeyHex)
  )
}

export function buildP2pkWitness(lwk: Lwk, params: { signatureHex: string }): LwkSimplicityWitnessValues {
  const SimplicityWitnessValues = lwk.SimplicityWitnessValues
  const SimplicityTypedValue = lwk.SimplicityTypedValue
  const w = new SimplicityWitnessValues()
  const next = w.addValue('SIGNATURE', SimplicityTypedValue.fromByteArrayHex(params.signatureHex))
  return (next as LwkSimplicityWitnessValues) ?? w
}
