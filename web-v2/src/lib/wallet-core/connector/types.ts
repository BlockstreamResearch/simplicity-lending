import type { Pset, Wollet, WolletDescriptor } from 'lwk_web'

import type { ConnectionStatus, WalletType } from '../types'

export interface WalletConnector {
  readonly id: string | null
  connect(): Promise<void>
  disconnect(): void
  getDescriptor(variant: WalletType): Promise<WolletDescriptor>
  signPset(pset: Pset): Promise<Pset>
  isConnected: boolean
  getConnectionStatus(): Promise<ConnectionStatus>
  getVerifiedReceiveAddress?(variant: WalletType, wollet: Wollet): Promise<string>
}
