import {
  Address,
  AssetId,
  ExternalUtxo,
  OutPoint,
  Pset,
  type TxBuilder,
  TxOutSecrets,
  WolletDescriptor,
} from '@lilbonekit/lwk-web'

import type { NetworkName } from '@/constants/env'
import { fetchTransaction } from '@/lwk/transaction'
import { EXPLICIT_SIGNATURE_MAX_WEIGHT_TO_SATISFY } from '@/lwk/utxo'
import { bytesToHex } from '@/utils/hex'

import type { ConnectionStatus, WalletCoin } from '../types'
import {
  createSession,
  type HumidAddressResult,
  humidChainId,
  type HumidGetUtxosResult,
  type HumidProvider,
  type HumidSignPsetParams,
  type HumidSignPsetResult,
  type HumidUtxo,
  type HumidWalletDescriptorResult,
  invokeMethod,
  revokeSession,
  switchChain,
  waitForHumid,
} from './humid/rpc'
import type { WalletConnector, WalletRequest } from './types'

const SIGHASH_ALL = 1

function outpointKey(txid: string, vout: number): string {
  return `${txid}:${vout}`
}

function rawAssetId(utxo: HumidUtxo): string {
  return utxo.assetId.slice(utxo.assetId.lastIndexOf(':') + 1)
}

// getUTXOs doesn't report heights, only whether a coin is spendable (confirmed); the app
// reads height() solely as a confirmed/unconfirmed flag.
function toWalletCoin(utxo: HumidUtxo): WalletCoin {
  return {
    outpoint: () => new OutPoint(outpointKey(utxo.txid, utxo.vout)),
    height: () => (utxo.spendable ? 1 : undefined),
    unblinded: () => ({
      asset: () => AssetId.fromString(rawAssetId(utxo)),
      value: () => BigInt(utxo.amount),
    }),
  }
}

/**
 * Experimental connector for the Humid browser extension, signing through its `signPset`
 * (not the tx manifest flow).
 *
 * Humid keeps its SLIP-77 blinding key, per the Liquid Wallet RPC profile: it discloses a
 * public `elwpkh(xpub)` descriptor and reports coins through `getUTXOs` (asset and amount,
 * no blinding factors). So the app can't see the user's coins through its own Wollet:
 * - coins come from `getUTXOs` (see getCoins);
 * - they enter TxBuilder as external UTXOs with `skipBlinding()`, and change goes to Humid's
 *   first address (see fundTxBuilder);
 * - Humid blinds the outputs with its own secrets and signs its inputs (see signPset).
 */
export class HumidConnector implements WalletConnector {
  private provider: HumidProvider | null = null
  private firstAddress: HumidAddressResult | null = null
  private _id: string | null = null
  private readonly chainId: string
  /** Coins from the last getCoins call, by outpoint. */
  private coins = new Map<string, HumidUtxo>()

  constructor(network: NetworkName) {
    this.chainId = humidChainId(network)
  }

  get id(): string | null {
    return this._id
  }

  get isConnected(): boolean {
    return this.provider !== null
  }

  async connect(): Promise<void> {
    if (this.provider) return
    const provider = await waitForHumid()
    const session = await createSession(provider, this.chainId)
    if (!session.sessionScopes[this.chainId]) await switchChain(provider, this.chainId)
    this.provider = provider
  }

  async disconnect(): Promise<void> {
    const provider = this.provider
    this.provider = null
    this._id = null
    this.coins.clear()
    this.firstAddress = null
    if (provider) await revokeSession(provider).catch(() => undefined)
  }

  async getDescriptor(): Promise<WalletRequest<WolletDescriptor>> {
    const provider = this.requireProvider()
    const [result, firstAddress] = await Promise.all([
      invokeMethod<HumidWalletDescriptorResult>(provider, this.chainId, 'getWalletDescriptor', {
        descriptorType: 'publicWalletDescriptor',
        descriptorFormat: [{ format: 'bip380-bip389-multipath' }],
      }),
      invokeMethod<HumidAddressResult>(provider, this.chainId, 'getAddress', {
        index: 0,
        confidential: true,
      }),
    ])
    const publicDescriptor = result.descriptors[0]?.descriptor
    if (!publicDescriptor) throw new Error('Humid did not return a wallet descriptor')

    this.firstAddress = firstAddress
    this._id = result.accountIdentifier
    const descriptor = new WolletDescriptor(`ct(elip151,${publicDescriptor.split('#')[0]})`)
    return { id: null, result: Promise.resolve(descriptor) }
  }

  /** The user's coins of the given assets, as Humid reports them. */
  async getCoins(assetIds: string[]): Promise<WalletCoin[]> {
    const provider = this.requireProvider()
    const results = await Promise.all(
      [...new Set(assetIds)].map(assetId =>
        invokeMethod<HumidGetUtxosResult>(provider, this.chainId, 'getUTXOs', {
          assetId: `${this.chainId}/elip144:${assetId}`,
        }),
      ),
    )
    const utxos = results.flatMap(result => result.utxos)
    this.coins = new Map(utxos.map(utxo => [outpointKey(utxo.txid, utxo.vout), utxo]))
    return utxos.map(toWalletCoin)
  }

  /**
   * Adds the user's coins to `txBuilder` the way Humid can sign them: as external UTXOs
   * with only their asset and amount, an unblinded PSET, and change to a Humid address.
   */
  async fundTxBuilder(txBuilder: TxBuilder, outpoints: OutPoint[]): Promise<TxBuilder> {
    const coins = outpoints.map(outpoint => {
      const key = outpointKey(outpoint.txid().toString(), outpoint.vout())
      const coin = this.coins.get(key)
      if (!coin) throw new Error(`${key} is not a Humid wallet coin`)
      return coin
    })
    const externalUtxos = await Promise.all(
      coins.map(async coin => {
        const tx = await fetchTransaction(new OutPoint(outpointKey(coin.txid, coin.vout)))
        const secrets = TxOutSecrets.fromExplicit(
          AssetId.fromString(rawAssetId(coin)),
          BigInt(coin.amount),
        )
        return new ExternalUtxo(
          coin.vout,
          tx,
          secrets,
          EXPLICIT_SIGNATURE_MAX_WEIGHT_TO_SATISFY,
          true,
        )
      }),
    )
    return txBuilder
      .addExternalUtxos(externalUtxos)
      .skipBlinding()
      .setChangeAddress(new Address(this.requireFirstAddress().address))
  }

  async signPset(pset: Pset): Promise<WalletRequest<Pset>> {
    const provider = this.requireProvider()
    const firstAddress = new Address(this.requireFirstAddress().address).toUnconfidential()
    const firstScriptHex = bytesToHex(firstAddress.scriptPubkey().bytes())

    const signInputs = pset.inputs().flatMap((input, index) => {
      const coin = this.coins.get(
        outpointKey(input.previousTxid().toString(), input.previousVout()),
      )
      const address = (() => {
        if (coin) return coin.address
        const script = input.previousScriptPubkey()
        if (script && bytesToHex(script.bytes()) === firstScriptHex) return firstAddress.toString()
        return null
      })()
      return address ? [{ index, address, sighashTypes: [SIGHASH_ALL] }] : []
    })
    if (signInputs.length === 0) throw new Error('The transaction has no Humid wallet inputs')

    const params: HumidSignPsetParams = { pset: pset.toString(), signInputs, broadcast: false }
    const result = invokeMethod<HumidSignPsetResult>(
      provider,
      this.chainId,
      'signPset',
      params,
    ).then(signed => new Pset(signed.pset))
    return { id: null, result }
  }

  receiveAddress(): string | null {
    return this.firstAddress?.address ?? null
  }

  async getConnectionStatus(): Promise<ConnectionStatus> {
    return this.provider ? 'ready' : 'disconnected'
  }

  private requireProvider(): HumidProvider {
    if (!this.provider) throw new Error('Humid is not connected')
    return this.provider
  }

  private requireFirstAddress(): HumidAddressResult {
    if (!this.firstAddress) throw new Error('Humid wallet address is not loaded')
    return this.firstAddress
  }
}
