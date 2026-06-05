import type {
  EsploraClient,
  Pset,
  WalletTxOut,
  Wollet,
  WolletDescriptor,
  XOnlyPublicKey,
} from 'lwk_web'

import type { WalletConnector } from '@/lib/wallet-core/connector/types'
import type { ConnectionStatus, WalletType } from '@/lib/wallet-core/types'

export interface WalletContextValue extends WalletState {
  connect(variant: WalletType): Promise<void>
  disconnect(): Promise<void>
  syncWallet(): Promise<void>
  signPset(pset: Pset): Promise<Pset>
  getWalletUtxos(): Promise<WalletTxOut[]>
  getWollet(): Promise<Wollet>
  getReceiveAddress(): Promise<string | null>
  verifyReceiveAddress(): Promise<string>
  getXOnlyPublicKey(): Promise<XOnlyPublicKey | null>
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
  balances: Record<string, string>
  // Resolved once on connect; null until ready.
  receiveAddress: string | null
  scriptPubkey: string | null
  xOnlyPubkey: string | null
  syncing: boolean
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
  balances: {},
  receiveAddress: null,
  scriptPubkey: null,
  xOnlyPubkey: null,
  syncing: false,
  usbDeviceDetected: false,
  error: null,
  isError: false,
}
