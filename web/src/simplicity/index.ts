/**
 * Simplicity covenants: sources and LWK interaction.
 * - sources: loaded at build time from web/simplicity-covenants.config.json (p2pk in web, rest from crates/contracts).
 * - lwk: wasm init, createP2trAddress(source, args, internalKey, network).
 */

export { getSource, listCovenantIds } from './sources'
export type { SimplicityCovenantId } from './sources'
export { getLwk, createP2trAddress } from './lwk'
export type {
  P2pkNetwork,
  CreateP2trAddressParams,
  Lwk,
  LwkKeypair,
  LwkNetwork,
  LwkScript,
  LwkSimplicityArguments,
  LwkSimplicityProgram,
  LwkSimplicityType,
  LwkSimplicityTypedValue,
  LwkSimplicityWitnessValues,
  LwkTransaction,
  LwkTxOut,
  LwkTxOutArray,
  LwkXOnlyPublicKey,
  PsetWithExtractTx,
} from './lwk'
