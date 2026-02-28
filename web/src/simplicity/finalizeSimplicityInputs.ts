/**
 * Universal finalization of Simplicity inputs: one loop over inputs with descriptors.
 * Each descriptor is either a covenant (fixed witness) or a signing descriptor (sign callback).
 */

import type { EsploraVout } from '../api/esplora'
import type {
  Lwk,
  LwkNetwork,
  LwkSimplicityProgram,
  LwkSimplicityWitnessValues,
  LwkTransaction,
  LwkTxOut,
  LwkXOnlyPublicKey,
  PsetWithExtractTx,
} from './lwk'
import { getLwk } from './lwk'
import { buildTxOutFromPrevout } from '../utility/buildTxOutFromPrevout'

export interface CovenantInputDescriptor {
  program: LwkSimplicityProgram
  internalKey: LwkXOnlyPublicKey
  witnessValues: LwkSimplicityWitnessValues
}

export interface SigningInputDescriptor {
  program: LwkSimplicityProgram
  internalKey: LwkXOnlyPublicKey
  sign(
    tx: LwkTransaction,
    utxos: LwkTxOut[],
    inputIndex: number
  ): LwkSimplicityWitnessValues | Promise<LwkSimplicityWitnessValues>
}

export type SimplicityInputDescriptor = CovenantInputDescriptor | SigningInputDescriptor

function isSigningDescriptor(
  d: SimplicityInputDescriptor
): d is SigningInputDescriptor {
  return 'sign' in d && typeof (d as SigningInputDescriptor).sign === 'function'
}

function buildTxOutsFromPrevouts(
  lwk: Lwk,
  network: 'mainnet' | 'testnet',
  prevouts: EsploraVout[]
): LwkTxOut[] {
  return prevouts.map((p) => buildTxOutFromPrevout(lwk, network, p))
}

export interface FinalizeSimplicityInputsParams {
  pset: PsetWithExtractTx
  prevouts: EsploraVout[]
  network: 'mainnet' | 'testnet'
  descriptors: SimplicityInputDescriptor[]
}

export interface FinalizeSimplicityInputsResult {
  signedTxHex: string
}

/**
 * Finalize all inputs of a transaction using the given descriptors.
 * Builds a fresh TxOut[] per input (LWK takes ownership). Descriptors order must match input order.
 */
export async function finalizeSimplicityInputs(
  params: FinalizeSimplicityInputsParams
): Promise<FinalizeSimplicityInputsResult> {
  const { pset, prevouts, network, descriptors } = params

  if (prevouts.length !== descriptors.length) {
    throw new Error(
      `Prevouts length ${prevouts.length} does not match descriptors length ${descriptors.length}`
    )
  }

  const lwk = await getLwk()
  const { Network, SimplicityLogLevel } = lwk
  const net: LwkNetwork =
    network === 'mainnet' ? Network.mainnet() : Network.testnet()

  let tx: LwkTransaction = pset.extractTx()

  for (let inputIndex = 0; inputIndex < descriptors.length; inputIndex++) {
    const descriptor = descriptors[inputIndex]
    const isSigning = isSigningDescriptor(descriptor)
    const utxosForFinalize = buildTxOutsFromPrevouts(lwk, network, prevouts)

    const witnessValues = isSigning
      ? await Promise.resolve(
          descriptor.sign(
            tx,
            // getSighashAll/finalizeTransaction consume wasm-backed TxOut objects;
            // signing must use a separate array instance from finalization.
            buildTxOutsFromPrevouts(lwk, network, prevouts),
            inputIndex
          )
        )
      : descriptor.witnessValues
    tx = descriptor.program.finalizeTransaction(
      tx,
      descriptor.internalKey,
      utxosForFinalize,
      inputIndex,
      witnessValues,
      net,
      SimplicityLogLevel.None
    )
  }

  return { signedTxHex: tx.toString() }
}
