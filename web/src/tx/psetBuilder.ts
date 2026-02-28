/**
 * Wrapper over LWK PsetBuilder for building PSETs without duplicating
 * OutPoint/TxOut/Script/Address handling and null-script fallbacks.
 */

import { getLwk } from '../simplicity'
import type { Lwk, LwkScript } from '../simplicity'
import type { EsploraVout } from '../api/esplora'
import { getScriptHexFromVout, bytesToHex } from '../utility/hex'

export type PsetNetwork = 'mainnet' | 'testnet'

/**
 * Esplora/Blockstream API returns txid in reversed byte order (display).
 * LWK expects txid in internal (consensus) order for OutPoint and assetIdFromIssuance.
 * Converts 64-char hex from display to internal by reversing the 32 bytes.
 */
export function txidDisplayToInternal(displayTxidHex: string): string {
  const hex = displayTxidHex.replace(/^0x/i, '').trim().toLowerCase()
  if (hex.length !== 64) throw new Error('txid must be 64 hex chars')
  const pairs: string[] = []
  for (let i = 0; i < 64; i += 2) pairs.push(hex.slice(i, i + 2))
  return pairs.reverse().join('')
}

function getScriptForAddress(lwk: Lwk, address: string): LwkScript {
  const addr = new lwk.Address(address)
  let script = addr.scriptPubkey()
  if (script == null) script = addr.toUnconfidential().scriptPubkey()
  if (script == null)
    throw new Error(`Address has no scriptPubkey (null from LWK): ${address.slice(0, 50)}...`)
  return script
}

export interface PsetBuilderApi {
  addInput(outpoint: { txid: string; vout: number }, prevout: EsploraVout): void
  /**
   * Add an input with sequence that enables tx-level nLockTime (for Lending liquidation: covenant checks nLockTime).
   * Call setFallbackLocktimeHeight(height) before build() to set the absolute block height.
   */
  addInputWithLocktimeSequence(outpoint: { txid: string; vout: number }, prevout: EsploraVout): void
  /**
   * Add an input with asset issuance. Returns the new asset id (hex) for use in outputs.
   */
  addInputWithIssuance(
    outpoint: { txid: string; vout: number },
    prevout: EsploraVout,
    issuanceAmount: bigint,
    issuanceEntropyBytes: Uint8Array
  ): string
  addOutputToAddress(address: string, amount: bigint, assetId?: string): void
  addOutputWithScript(scriptPubkeyHex: string, amount: bigint, assetId?: string): void
  addFeeOutput(amount: bigint): void
  /** Policy asset (LBTC) hex for explicit change outputs. */
  getPolicyAssetHex(): string
  /** Set fallback locktime: tx is valid only when block height >= height. Call before build(). */
  setFallbackLocktimeHeight(height: number): void
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
    ContractHash,
    LockTime,
    TxSequence,
    assetIdFromIssuance,
  } = lwk

  const net = network === 'mainnet' ? Network.mainnet() : Network.testnet()
  const policyAsset = net.policyAsset()

  let builder = PsetBuilder.newV2()
  const inputTxOuts: unknown[] = []
  let fallbackLocktimeHeight: number | null = null

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

    addInputWithLocktimeSequence(
      outpoint: { txid: string; vout: number },
      prevout: EsploraVout
    ) {
      const scriptHex = getScriptHexFromVout(prevout)
      const value = prevout.value
      if (value == null || value < 0) throw new Error('Missing or invalid prevout value')
      const assetHex = prevout.asset ?? policyAsset.toString()
      const script = new Script(scriptHex)
      const assetId = new AssetId(assetHex)
      const txOut = TxOut.fromExplicit(script, assetId, BigInt(value))
      inputTxOuts.push(txOut)

      const op = OutPoint.fromParts(new Txid(outpoint.txid), outpoint.vout)
      const seq =
        (TxSequence as { enableLocktimeNoRbf?: () => unknown }).enableLocktimeNoRbf?.() ??
        (TxSequence as { enable_locktime_no_rbf?: () => unknown }).enable_locktime_no_rbf?.()
      const psetInput =
        seq != null && typeof (seq as { to_consensus_u32?: unknown }).to_consensus_u32 === 'function'
          ? PsetInputBuilder.fromPrevout(op).witnessUtxo(txOut).sequence(seq as Parameters<ReturnType<typeof PsetInputBuilder.fromPrevout>['sequence']>[0]).build()
          : PsetInputBuilder.fromPrevout(op).witnessUtxo(txOut).build()
      builder = builder.addInput(psetInput)
    },

    addInputWithIssuance(
      outpoint: { txid: string; vout: number },
      prevout: EsploraVout,
      issuanceAmount: bigint,
      issuanceEntropyBytes: Uint8Array
    ): string {
      const scriptHex = getScriptHexFromVout(prevout)
      const value = prevout.value
      if (value == null || value < 0) throw new Error('Missing or invalid prevout value')
      const assetHex = prevout.asset ?? policyAsset.toString()
      const script = new Script(scriptHex)
      const assetId = new AssetId(assetHex)
      const txOut = TxOut.fromExplicit(script, assetId, BigInt(value))
      inputTxOuts.push(txOut)

      const op = OutPoint.fromParts(new Txid(outpoint.txid), outpoint.vout)
      const contractHash = ContractHash.fromBytes(issuanceEntropyBytes)
      const psetInput = PsetInputBuilder.fromPrevout(op)
        .witnessUtxo(txOut)
        .issuanceValueAmount(issuanceAmount)
        .issuanceAssetEntropy(contractHash)
        .blindedIssuance(false)
        .build()
      builder = builder.addInput(psetInput)
      const newAssetId = assetIdFromIssuance(op, contractHash)
      return newAssetId.toString()
    },

    addOutputToAddress(address: string, amount: bigint, assetIdHex?: string) {
      const scriptFromAddr = getScriptForAddress(lwk, address)
      const scriptHex = bytesToHex(scriptFromAddr.bytes())
      const script = new Script(scriptHex)
      const assetHex = assetIdHex ?? policyAsset.toString()
      const asset = new AssetId(assetHex)
      builder = builder.addOutput(PsetOutputBuilder.newExplicit(script, amount, asset).build())
    },

    addOutputWithScript(scriptPubkeyHex: string, amount: bigint, assetIdHex?: string) {
      const script = new Script(scriptPubkeyHex)
      const assetHex = assetIdHex ?? policyAsset.toString()
      const asset = new AssetId(assetHex)
      const builtOutput = PsetOutputBuilder.newExplicit(script, amount, asset).build()
      builder = builder.addOutput(builtOutput)
    },

    addFeeOutput(amount: bigint) {
      const emptyScript = Script.empty()
      const policyHex = policyAsset.toString()
      const feeAsset = new AssetId(policyHex)
      builder = builder.addOutput(
        PsetOutputBuilder.newExplicit(emptyScript, amount, feeAsset).build()
      )
    },

    getPolicyAssetHex(): string {
      return policyAsset.toString()
    },

    setFallbackLocktimeHeight(height: number) {
      fallbackLocktimeHeight = height
    },

    build() {
      if (fallbackLocktimeHeight != null) {
        builder = builder.setFallbackLocktime(LockTime.from_height(fallbackLocktimeHeight))
      }
      const pset = builder.build()
      return { pset, inputTxOuts }
    },
  }
}
