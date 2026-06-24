import {
  Jade,
  type Network,
  type Pset,
  Singlesig,
  type Wollet,
  type WolletDescriptor,
} from 'lwk_web'

import type { ConnectionStatus, JadeVersionInfo, WalletType } from '../types'
import { DEFAULT_WALLET_TYPE } from '../types'
import { JadeBusyError, JadeNotConnectedError, mapJadeRpcError, toJadeConnectError } from './errors'
import type { WalletConnector } from './types'

/**
 * Production hardware wallet connector for Jade.
 *
 * Jade is a WASM-backed object — it holds a Rust memory pointer internally.
 * It must NOT be stored in React state. This class owns the Jade reference
 * exclusively and exposes only framework-agnostic methods.
 */
export class JadeConnector implements WalletConnector {
  private jade: Jade | null = null
  private busy = false
  private _id: string | null = null

  constructor(private readonly lwkNetwork: Network) {}

  async connect(): Promise<void> {
    if (this.jade !== null) return
    try {
      this.jade = await Jade.fromSerial(this.lwkNetwork, true)
    } catch (error) {
      throw toJadeConnectError(error)
    }
  }

  async disconnect(): Promise<void> {
    if (this.jade) {
      try {
        // Releases the WebSerial port's reader/writer locks and closes it, so the
        // next connect() can reopen the port without needing a page reload.
        await this.jade.disconnect()
      } catch {
        // Port may already be gone (e.g. device unplugged) — still free the wasm object.
      } finally {
        this.jade.free()
        this.jade = null
      }
    }
    this._id = null
  }

  get id(): string | null {
    return this._id
  }

  async getVersionInfo(): Promise<JadeVersionInfo> {
    if (!this.jade) throw new JadeNotConnectedError()
    try {
      const raw = await this.jade.getVersion()
      const info = {
        state: raw.JADE_STATE as JadeVersionInfo['state'],
        efuseMac: raw.EFUSEMAC as string,
        version: raw.JADE_VERSION as string,
      }
      this._id ??= info.efuseMac
      return info
    } catch (error) {
      throw mapJadeRpcError(error)
    }
  }

  async getConnectionStatus(): Promise<ConnectionStatus> {
    // HACK: Mutex polling and sign() share the same WebSerial port. If sign() is in
    // progress (waiting for user button press), skip the poll to avoid CBOR
    // frame corruption that would silently kill the signing request.
    if (this.busy) throw new JadeBusyError()
    const info = await this.getVersionInfo()
    return info.state === 'READY' ? 'ready' : 'locked'
  }

  async getDescriptor(variant: WalletType): Promise<WolletDescriptor> {
    if (!this.jade) throw new JadeNotConnectedError()
    try {
      // wpkh = elwpkh native segwit; shWpkh = nested segwit (sh-wpkh).
      return variant === DEFAULT_WALLET_TYPE ? await this.jade.wpkh() : await this.jade.shWpkh()
    } catch (error) {
      throw mapJadeRpcError(error)
    }
  }

  async signPset(pset: Pset): Promise<Pset> {
    if (!this.jade) throw new JadeNotConnectedError()
    this.busy = true
    try {
      return await this.jade.sign(pset)
    } catch (error) {
      throw mapJadeRpcError(error)
    } finally {
      this.busy = false
    }
  }

  /**
   * Ask Jade to display and confirm the receive address on-device.
   *
   * Jade shows the address on its screen and requires a button press to confirm.
   * The returned string is the address as verified by the hardware — compare it
   * against the software-derived address to detect substitution attacks.
   */
  async getVerifiedReceiveAddress(variant: WalletType, wollet: Wollet): Promise<string> {
    if (!this.jade) throw new JadeNotConnectedError()
    const addrResult = wollet.address()
    const index = addrResult.index()
    const path = wollet.addressFullPath(index)
    const singlesig = Singlesig.from(variant)
    try {
      return await this.jade.getReceiveAddressSingle(singlesig, path)
    } catch (error) {
      throw mapJadeRpcError(error)
    }
  }

  get isConnected(): boolean {
    return this.jade !== null
  }
}
