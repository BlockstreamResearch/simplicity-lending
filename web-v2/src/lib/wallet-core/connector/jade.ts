import type { Jade, Network, Pset, WolletDescriptor } from 'lwk_web'

import type { Lwk } from '@/lwk'

import type { ConnectionStatus, JadeVersionInfo, SinglesigVariant } from '../types'
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

  constructor(
    private readonly lwk: Lwk,
    private readonly lwkNetwork: Network,
  ) {}

  async connect(): Promise<void> {
    if (this.jade !== null) return
    // HACK: The TS bindings declare this as a sync constructor, but wasm-bindgen
    // generates an async constructor under the hood that returns a Promise.
    // `await new this.lwk.Jade(...)` is intentional — not a mistake.
    this.jade = await new this.lwk.Jade(this.lwkNetwork, true)
  }

  async disconnect(): Promise<void> {
    if (this.jade) {
      this.jade.free()
      this.jade = null
    }
  }

  async readVersion(): Promise<JadeVersionInfo> {
    if (!this.jade) throw new Error('JadeConnector: not connected')
    const raw = await this.jade.getVersion()
    return {
      jadeState: raw.JADE_STATE as JadeVersionInfo['jadeState'],
      jadeMac: raw.EFUSEMAC as string,
      jadeVersion: raw.JADE_VERSION as string,
    }
  }

  async getConnectionState(): Promise<ConnectionStatus> {
    // HACK: Mutex polling and sign() share the same WebSerial port. If sign() is in
    // progress (waiting for user button press), skip the poll to avoid CBOR
    // frame corruption that would silently kill the signing request.
    if (this.busy) throw new Error('jade:busy')
    const info = await this.readVersion()
    return info.jadeState === 'READY' ? 'ready' : 'locked'
  }

  async getDescriptor(variant: SinglesigVariant): Promise<WolletDescriptor> {
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

  isConnected(): boolean {
    return this.jade !== null
  }
}
