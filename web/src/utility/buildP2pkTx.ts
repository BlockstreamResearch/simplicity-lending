/**
 * Build and sign a single-input P2PK (Simplicity) transaction that spends one UTXO
 * to multiple outputs (native asset only) plus a fee output.
 * Uses tx/psetBuilder wrapper for PSET construction, then LWK SimplicityProgram for signing.
 */

import { getLwk, getSource } from '../simplicity'
import type { P2pkNetwork } from '../simplicity'
import type { EsploraVout } from '../api/esplora'
import { createPsetBuilder } from '../tx/psetBuilder'
import { buildTxOutFromPrevout } from './buildTxOutFromPrevout'

export interface BuildP2pkTxParams {
  /** OutPoint to spend (txid + vout index). */
  outpoint: { txid: string; vout: number }
  /** Previous output as returned by Esplora (scriptpubkey hex, value, asset). */
  prevout: EsploraVout
  /** Recipient outputs: address + amount in sats (native asset only). */
  outputs: { address: string; amount: bigint }[]
  /** Change output (back to user). Omit if amount is 0. */
  change: { address: string; amount: bigint } | null
  /** Fee amount in sats (native asset). Last output with empty script. */
  feeAmount: bigint
  /** Secret key (32 bytes) for the P2PK input. */
  secretKey: Uint8Array
  network: P2pkNetwork
}

/**
 * Build unsigned PSET via wrapper, sign the single P2PK input, and return the signed transaction hex.
 */
export async function buildAndSignP2pkTx(params: BuildP2pkTxParams): Promise<string> {
  const network: 'mainnet' | 'testnet' = params.network === 'mainnet' ? 'mainnet' : 'testnet'
  const api = await createPsetBuilder(network)
  api.addInput(params.outpoint, params.prevout)
  for (const o of params.outputs) {
    api.addOutputToAddress(o.address, o.amount)
  }
  if (params.change && params.change.amount > 0n) {
    api.addOutputToAddress(params.change.address, params.change.amount)
  }
  api.addFeeOutput(params.feeAmount)
  const { pset } = api.build()

  const lwk = await getLwk()
  const {
    Network,
    Keypair,
    SimplicityProgram,
    SimplicityArguments,
    SimplicityTypedValue,
    SimplicityWitnessValues,
    SimplicityLogLevel,
  } = lwk

  const net = params.network === 'mainnet' ? Network.mainnet() : Network.testnet()

  const keypair = new Keypair(params.secretKey)
  const internalKey = keypair.xOnlyPublicKey()
  const args = new SimplicityArguments().addValue(
    'PUBLIC_KEY',
    SimplicityTypedValue.fromU256Hex(internalKey.toHex())
  )
  const program = new SimplicityProgram(getSource('p2pk'), args)

  // LWK consumes the utxos array; use separate TxOut instances per call (Option B).
  const utxosForSighash = [buildTxOutFromPrevout(lwk, network, params.prevout)] as Parameters<
    typeof program.getSighashAll
  >[2]
  const utxosForFinalize = [buildTxOutFromPrevout(lwk, network, params.prevout)] as Parameters<
    typeof program.finalizeTransaction
  >[2]

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- LWK Transaction from pset.extractTx()
  let tx = (pset as { extractTx(): any }).extractTx()

  const sighashHex = program.getSighashAll(tx, internalKey, utxosForSighash, 0, net)
  const sigHex = keypair.signSchnorr(sighashHex)
  const witnessValues = new SimplicityWitnessValues().addValue(
    'SIGNATURE',
    lwk.SimplicityTypedValue.fromByteArrayHex(sigHex)
  )

  tx = program.finalizeTransaction(
    tx,
    internalKey,
    utxosForFinalize,
    0,
    witnessValues,
    net,
    SimplicityLogLevel.None
  )

  return tx.toString()
}
