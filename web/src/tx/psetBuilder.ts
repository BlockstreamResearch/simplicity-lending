/**
 * Wrapper over LWK PsetBuilder for building PSETs without duplicating
 * OutPoint/TxOut/Script/Address handling and null-script fallbacks.
 */

import { getLwk } from '../simplicity'
import type { Lwk } from '../simplicity'
import type { EsploraVout } from '../api/esplora'

export type PsetNetwork = 'mainnet' | 'testnet'

function getScriptHexFromVout(vout: EsploraVout): string {
  const sp = vout.scriptpubkey
  const hex =
    vout.scriptpubkey_hex ??
    (typeof sp === 'string'
      ? sp
      : sp && typeof sp === 'object' && 'hex' in sp
        ? (sp as { hex: string }).hex
        : undefined)
  if (!hex || typeof hex !== 'string') throw new Error('Missing scriptpubkey hex in vout')
  return hex
}

function getScriptForAddress(lwk: Lwk, address: string): InstanceType<Lwk['Script']> {
  const addr = new lwk.Address(address)
  let script = addr.scriptPubkey()
  if (script == null) script = addr.toUnconfidential().scriptPubkey()
  if (script == null)
    throw new Error(`Address has no scriptPubkey (null from LWK): ${address.slice(0, 50)}...`)
  return script
}

/** Get script pubkey hex from LWK Script (bytes to hex). Avoids passing Address-derived Script into PsetOutputBuilder. */
function scriptToHex(script: { bytes(): Iterable<number> | Uint8Array }): string {
  const bytes = script.bytes()
  return Array.from(bytes)
    .map((b) => (Number(b) & 0xff).toString(16).padStart(2, '0'))
    .join('')
}

export interface PsetBuilderApi {
  addInput(outpoint: { txid: string; vout: number }, prevout: EsploraVout): void
  addOutputToAddress(address: string, amount: bigint, assetId?: string): void
  addOutputWithScript(scriptPubkeyHex: string, amount: bigint, assetId?: string): void
  addFeeOutput(amount: bigint): void
  build(): { pset: unknown; inputTxOuts: unknown[] }
}

/**
 * Create a PSET builder for the given network. Use the returned API to add
 * inputs/outputs, then call build() to get the Pset and the TxOut list for
 * inputs (for signing).
 */
export async function createPsetBuilder(network: PsetNetwork): Promise<PsetBuilderApi> {
  const lwk = await getLwk()
  const {
    PsetBuilder,
    PsetInputBuilder,
    PsetOutputBuilder,
    OutPoint,
    Txid,
    TxOut,
    Script,
    AssetId,
    Network,
  } = lwk

  const net = network === 'mainnet' ? Network.mainnet() : Network.testnet()
  const policyAsset = net.policyAsset()

  let builder = PsetBuilder.newV2()
  const inputTxOuts: unknown[] = []

  return {
    addInput(outpoint: { txid: string; vout: number }, prevout: EsploraVout) {
      const scriptHex = getScriptHexFromVout(prevout)
      const value = prevout.value
      if (value == null || value < 0) throw new Error('Missing or invalid prevout value')
      const assetHex = prevout.asset ?? policyAsset.toString()
      const script = new Script(scriptHex)
      const assetId = new AssetId(assetHex)
      const txOut = TxOut.fromExplicit(script, assetId, BigInt(value))
      inputTxOuts.push(txOut)

      const op = OutPoint.fromParts(new Txid(outpoint.txid), outpoint.vout)
      const psetInput = PsetInputBuilder.fromPrevout(op).witnessUtxo(txOut).build()
      builder = builder.addInput(psetInput)
    },

    addOutputToAddress(address: string, amount: bigint, assetIdHex?: string) {
      const scriptFromAddr = getScriptForAddress(lwk, address)
      const scriptHex = scriptToHex(scriptFromAddr)
      const script = new Script(scriptHex)
      const asset = assetIdHex ? new AssetId(assetIdHex) : new AssetId(policyAsset.toString())
      builder = builder.addOutput(PsetOutputBuilder.newExplicit(script, amount, asset).build())
    },

    addOutputWithScript(scriptPubkeyHex: string, amount: bigint, assetIdHex?: string) {
      const script = new Script(scriptPubkeyHex)
      const asset = assetIdHex ? new AssetId(assetIdHex) : new AssetId(policyAsset.toString())
      const builtOutput = PsetOutputBuilder.newExplicit(script, amount, asset).build()
      builder = builder.addOutput(builtOutput)
    },

    addFeeOutput(amount: bigint) {
      const emptyScript = Script.empty()
      const feeAsset = new AssetId(policyAsset.toString())
      builder = builder.addOutput(
        PsetOutputBuilder.newExplicit(emptyScript, amount, feeAsset).build()
      )
    },

    build() {
      const pset = builder.build()
      return { pset, inputTxOuts }
    },
  }
}
