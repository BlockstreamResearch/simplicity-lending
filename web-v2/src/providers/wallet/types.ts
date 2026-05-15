import type { Pset } from 'lwk_web'

import type { SavedSession, SinglesigVariant, WalletState } from '@/lib/wallet-core/types'

export interface WalletContextValue extends WalletState {
  connect(variant: SinglesigVariant): Promise<void>
  disconnect(): Promise<void>
  sync(): Promise<void>
  signAndBroadcast(pset: Pset): Promise<string>
  sendLbtc(recipientAddress: string, satoshi: bigint): Promise<string>
  getLastReceiveAddress(): string | null
  resumeSession(): Promise<void>
  savedSession: SavedSession | null
}
