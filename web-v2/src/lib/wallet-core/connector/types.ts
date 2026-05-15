import type { Pset, WolletDescriptor } from 'lwk_web'

import type { ConnectionStatus, JadeVersionInfo, SinglesigVariant } from '../types'

export interface WalletConnector {
  connect(): Promise<void>
  disconnect(): Promise<void>
  getDescriptor(variant: SinglesigVariant): Promise<WolletDescriptor>
  signPset(pset: Pset): Promise<Pset>
  isConnected(): boolean
  readVersion?(): Promise<JadeVersionInfo>
  getConnectionState?(): Promise<ConnectionStatus>
}
