import type { EsploraClient, Pset, WalletTxOut, Wollet, WolletDescriptor } from 'lwk_web'

import type { WalletConnector } from '@/lib/wallet-core/connector/types'
import type { ConnectionStatus, WalletType } from '@/lib/wallet-core/types'

export interface WalletContextValue extends WalletState {
  isReady: boolean
  connect(variant: WalletType): Promise<void>
  disconnect(): Promise<void>
  syncWallet(): Promise<void>
  signPset(pset: Pset): Promise<Pset>
  getBlindedWalletUtxos(): Promise<WalletTxOut[]>
  getWollet(): Promise<Wollet>
  getReceiveAddress(): Promise<string | null>
  verifyReceiveAddress(): Promise<string>
}

export interface WalletSession {
  connector: WalletConnector
  descriptor: WolletDescriptor
  wollet: Wollet
  esploraClient: EsploraClient
}

export interface SavedSession {
  connectorId: string | null
  walletType: WalletType
  descriptorStr: string
}

export interface WalletState {
  connectionStatus: ConnectionStatus
  connectorId: string | null
  walletType: WalletType | null
  /** Whether the active/connecting connector is a real Jade device (vs. the debug seed signer). */
  isJade: boolean
  balances: Record<string, string>
  // Resolved once on connect; null until ready.
  receiveAddress: string | null
  scriptPubkey: string | null
  syncing: boolean
  reconnecting: boolean
  usbDeviceDetected: boolean
  /** Last error message. Persists even after isError is cleared. */
  error: string | null
  /** Whether the error should be shown to the user. Cleared on reconnect or new connect attempt. */
  isError: boolean
}

export const INITIAL_WALLET_STATE: WalletState = {
  connectionStatus: 'disconnected',
  connectorId: null,
  walletType: null,
  isJade: false,
  balances: {},
  receiveAddress: null,
  scriptPubkey: null,
  syncing: false,
  reconnecting: false,
  usbDeviceDetected: false,
  error: null,
  isError: false,
}
