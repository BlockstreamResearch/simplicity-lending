import type { Network, Pset, Signer, WolletDescriptor } from 'lwk_web'

import type { Lwk } from '@/lwk'

import type { SinglesigVariant } from '../types'
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

  constructor(
    private readonly lwk: Lwk,
    private readonly lwkNetwork: Network,
    private readonly mnemonicStr: string,
  ) {
    if (!mnemonicStr) throw new Error('SeedConnector: VITE_DEBUG_MNEMONIC is not set')
  }

  async connect(): Promise<void> {
    if (this.signer !== null) return
    const mnemonic = new this.lwk.Mnemonic(this.mnemonicStr)
    this.signer = new this.lwk.Signer(mnemonic, this.lwkNetwork)
  }

  async disconnect(): Promise<void> {
    if (this.signer) {
      this.signer.free()
      this.signer = null
    }
  }

  async getDescriptor(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _variant: SinglesigVariant,
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

  isConnected(): boolean {
    return this.signer !== null
  }
}
