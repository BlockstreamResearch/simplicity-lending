import { Mnemonic, type Network, type Pset, Signer, type WolletDescriptor } from 'lwk_web'

import type { ConnectionStatus, WalletType } from '../types'
import type { WalletConnector } from './types'

/**
 * Software signer connector backed by a BIP39 mnemonic.
 *
 * Intended for dev/test only — never ship a real mnemonic in env vars.
 * Gate behind VITE_DEBUG_MNEMONIC so it never runs in production builds.
 *
 * Signer is a WASM-backed object. It must NOT be stored in React state.
 * This class owns the Signer reference exclusively.
 */
export class SeedConnector implements WalletConnector {
  private signer: Signer | null = null
  private _id: string | null = null

  constructor(
    private readonly lwkNetwork: Network,
    private readonly mnemonicStr: string,
  ) {
    if (!mnemonicStr) throw new Error('SeedConnector: VITE_DEBUG_MNEMONIC is not set')
  }

  async connect(): Promise<void> {
    if (this.signer !== null) return
    const mnemonic = new Mnemonic(this.mnemonicStr)
    this.signer = new Signer(mnemonic, this.lwkNetwork)
    this._id = crypto.randomUUID()
  }

  disconnect(): void {
    if (this.signer) {
      this.signer.free()
      this.signer = null
    }
    this._id = null
  }

  get id(): string | null {
    return this._id
  }

  async getDescriptor(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _variant: WalletType,
  ): Promise<WolletDescriptor> {
    if (!this.signer) throw new Error('SeedConnector: not connected')
    // Signer only exposes wpkhSlip77Descriptor (native segwit + SLIP77 blinding).
    // The variant param is accepted for interface compatibility but ignored here.
    return this.signer.wpkhSlip77Descriptor()
  }

  async signPset(pset: Pset): Promise<Pset> {
    if (!this.signer) throw new Error('SeedConnector: not connected')
    // Signer.sign() is synchronous — wrap for interface compatibility.
    return this.signer.sign(pset)
  }

  async getConnectionStatus(): Promise<ConnectionStatus> {
    return this.signer ? 'ready' : 'disconnected'
  }

  get isConnected(): boolean {
    return this.signer !== null
  }
}
