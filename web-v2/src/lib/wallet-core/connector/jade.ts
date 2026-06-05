import {
  Jade,
  type Network,
  type Pset,
  Singlesig,
  type Wollet,
  type WolletDescriptor,
} from 'lwk_web'

import type { ConnectionStatus, JadeVersionInfo, WalletType } from '../types'
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
    // HACK: The TS bindings declare this as a sync constructor, but wasm-bindgen
    // generates an async constructor under the hood that returns a Promise.
    // `await new this.lwk.Jade(...)` is intentional — not a mistake.
    this.jade = await new Jade(this.lwkNetwork, true)
  }

  disconnect(): void {
    if (this.jade) {
      this.jade.free()
      this.jade = null
    }
    this._id = null
  }

  get id(): string | null {
    return this._id
  }

  async getVersionInfo(): Promise<JadeVersionInfo> {
    if (!this.jade) throw new Error('JadeConnector: not connected')
    const raw = await this.jade.getVersion()
    const info = {
      state: raw.JADE_STATE as JadeVersionInfo['state'],
      efuseMac: raw.EFUSEMAC as string,
      version: raw.JADE_VERSION as string,
    }
    this._id ??= info.efuseMac
    return info
  }

  async getConnectionStatus(): Promise<ConnectionStatus> {
    // HACK: Mutex polling and sign() share the same WebSerial port. If sign() is in
    // progress (waiting for user button press), skip the poll to avoid CBOR
    // frame corruption that would silently kill the signing request.
    if (this.busy) throw new Error('jade:busy')
    const info = await this.getVersionInfo()
    return info.state === 'READY' ? 'ready' : 'locked'
  }

  async getDescriptor(variant: WalletType): Promise<WolletDescriptor> {
    if (!this.jade) throw new Error('JadeConnector: not connected')
    // wpkh = elwpkh native segwit; shWpkh = nested segwit (sh-wpkh).
    return variant === 'Wpkh' ? this.jade.wpkh() : this.jade.shWpkh()
  }

  async signPset(pset: Pset): Promise<Pset> {
    if (!this.jade) throw new Error('JadeConnector: not connected')
    this.busy = true
    try {
      return await this.jade.sign(pset)
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
    if (!this.jade) throw new Error('JadeConnector: not connected')
    const addrResult = wollet.address()
    const index = addrResult.index()
    const path = wollet.addressFullPath(index)
    const singlesig = Singlesig.from(variant)
    return await this.jade.getReceiveAddressSingle(singlesig, path)
  }

  get isConnected(): boolean {
    return this.jade !== null
  }
}
