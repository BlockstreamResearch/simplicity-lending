import type { EsploraClient, Pset, Wollet, WolletDescriptor } from 'lwk_web'

import type { WalletConnector } from '@/lib/wallet-core/connector/types'
import type { ConnectionStatus, WalletType } from '@/lib/wallet-core/types'

export interface WalletContextValue extends WalletState {
  connect(variant: WalletType): Promise<void>
  disconnect(): Promise<void>
  sync(): Promise<void>
  signAndBroadcast(pset: Pset): Promise<string>
  sendLbtc(recipientAddress: string, satoshi: bigint): Promise<string>
  getLastReceiveAddress(): string | null
  verifyReceiveAddress(): Promise<string | null>
  getXOnlyPublicKey(): Promise<string | null>
  resumeSession(): Promise<void>
  savedSession: SavedSession | null
}

export interface WalletSession {
  connector: WalletConnector
  descriptor: WolletDescriptor
  wollet: Wollet
  esploraClient: EsploraClient
}

export interface SavedSession {
  efuseMac: string | null
  walletType: WalletType
  descriptorStr: string
}

export interface WalletState {
  connectionStatus: ConnectionStatus
  efuseMac: string | null
  walletType: WalletType | null
  balances: Record<string, string>
  syncing: boolean
  usbDeviceDetected: boolean
  /** Last error message. Persists even after isError is cleared. */
  error: string | null
  /** Whether the error should be shown to the user. Cleared on reconnect or new connect attempt. */
  isError: boolean
}

export const INITIAL_WALLET_STATE: WalletState = {
  connectionStatus: 'disconnected',
  efuseMac: null,
  walletType: null,
  balances: {},
  syncing: false,
  usbDeviceDetected: false,
  error: null,
  isError: false,
}
