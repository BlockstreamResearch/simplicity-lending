import type {
  EsploraClient,
  Pset,
  Transaction,
  WalletTxOut,
  Wollet,
  WolletDescriptor,
} from '@lilbonekit/lwk-web'

import type { WalletConnector } from '@/lib/wallet-core/connector/types'
import type { ConnectionStatus, WalletType } from '@/lib/wallet-core/types'

export interface ConnectOptions {
  seedMnemonic?: string
  /** Connect via the experimental SideSwap wallet connect flow instead of Jade/seed. */
  sideswap?: boolean
  /** Only reattach to a still-live SideSwap session; never start a fresh login request. */
  resumeOnly?: boolean
}

export interface WalletContextValue extends WalletState {
  isReady: boolean
  connect(variant: WalletType, options?: ConnectOptions): Promise<void>
  /** Cancels an in-flight SideSwap login/sign request and resets the connection. */
  cancelPendingRequest(): Promise<void>
  disconnect(): Promise<void>
  syncWallet(): Promise<void>
  /** Applies a just-broadcast tx to local wallet state instantly, without a network scan. */
  applyBroadcastTransaction(tx: Transaction): void
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
  /** Set only for seed-signer sessions — needed to silently reconnect the software signer on reload. */
  seedMnemonic?: string
  sideswap?: boolean
}

export type WalletSignerType = 'jade' | 'seed' | 'sideswap'

// appLink is null for sign requests — the deep-link format for those isn't confirmed yet.
export interface PendingWalletRequest {
  kind: 'login' | 'sign'
  requestId: string
  appLink: string | null
}

export interface WalletState {
  connectionStatus: ConnectionStatus
  connectorId: string | null
  walletType: WalletType | null
  signerType: WalletSignerType | null
  balances: Record<string, string>
  confirmedBalances: Record<string, string>
  pendingBalances: Record<string, string>
  // Resolved once on connect; null until ready.
  receiveAddress: string | null
  scriptPubkey: string | null
  syncing: boolean
  reconnecting: boolean
  usbDeviceDetected: boolean
  pendingRequest: PendingWalletRequest | null
  /** Last error message. Persists even after isError is cleared. */
  error: string | null
  /** Whether the error should be shown to the user. Cleared on reconnect or new connect attempt. */
  isError: boolean
}

export const INITIAL_WALLET_STATE: WalletState = {
  connectionStatus: 'disconnected',
  connectorId: null,
  walletType: null,
  signerType: null,
  balances: {},
  confirmedBalances: {},
  pendingBalances: {},
  receiveAddress: null,
  scriptPubkey: null,
  syncing: false,
  reconnecting: false,
  usbDeviceDetected: false,
  pendingRequest: null,
  error: null,
  isError: false,
}
