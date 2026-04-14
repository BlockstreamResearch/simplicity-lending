/**
 * Sign all P2PK (Simplicity) inputs of a transaction built from a PSET.
 * Uses LWK SimplicityProgram: for each input, builds fresh TxOut array (Option B), getSighashAll, sign, finalize.
 * prevouts length must equal the number of P2PK inputs in the transaction.
 */

import { getSource } from '../simplicity'
import type { Lwk, LwkTransaction, PsetWithExtractTx } from '../simplicity'
import type { EsploraVout } from '../api/esplora'
import { buildTxOutFromPrevout } from './buildTxOutFromPrevout'

export interface SignP2pkInputsParams {
  lwk: Lwk
  network: 'mainnet' | 'testnet'
  pset: PsetWithExtractTx
  secretKey: Uint8Array
  /** One prevout per P2PK input, in the same order as inputs. */
  prevouts: EsploraVout[]
}

/**
 * Sign each P2PK input in order; return the signed transaction as hex string.
 */
export function signP2pkInputs(params: SignP2pkInputsParams): string {
  const { lwk, network, pset, secretKey, prevouts } = params
  const {
    Network,
    Keypair,
    SimplicityProgram,
    SimplicityArguments,
    SimplicityTypedValue,
    SimplicityWitnessValues,
    SimplicityLogLevel,
  } = lwk

  const net = network === 'mainnet' ? Network.mainnet() : Network.testnet()
  const keypair = Keypair.fromSecretBytes(secretKey)
  const internalKey = keypair.xOnlyPublicKey
  const args = new SimplicityArguments().addValue(
    'PUBLIC_KEY',
    SimplicityTypedValue.fromU256Hex(internalKey.toString())
  )
  const program = SimplicityProgram.load(getSource('p2pk'), args)

  let tx: LwkTransaction = pset.extractTx()

  for (let inputIndex = 0; inputIndex < prevouts.length; inputIndex++) {
    const utxosForSighash = prevouts.map((p) =>
      buildTxOutFromPrevout(lwk, network, p)
    ) as Parameters<typeof program.getSighashAll>[2]
    const utxosForFinalize = prevouts.map((p) =>
      buildTxOutFromPrevout(lwk, network, p)
    ) as Parameters<typeof program.finalizeTransaction>[2]

    const sighashHex = program.getSighashAll(tx, internalKey, utxosForSighash, inputIndex, net)
    const sigHex = keypair.signSchnorr(sighashHex)
    const witnessValues = new SimplicityWitnessValues().addValue(
      'SIGNATURE',
      lwk.SimplicityTypedValue.fromByteArrayHex(sigHex)
    )

    tx = program.finalizeTransaction(
      tx,
      internalKey,
      utxosForFinalize,
      inputIndex,
      witnessValues,
      net,
      SimplicityLogLevel.None
    )
  }

  return tx.toString()
}
