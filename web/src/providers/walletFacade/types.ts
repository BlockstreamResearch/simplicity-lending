import type { Pset, Transaction, WalletTxOut, Wollet } from '@lilbonekit/lwk-web'

import type { WalletActionRequest, WalletActionResult } from '@/lib/wallet/types'

/**
 * How far the connection has got, in the vocabulary the screens already read.
 *
 * `locked` belongs to a device that asks for a PIN. No wallet behind the facade does that
 * today, so nothing produces it; it stays in the union because the screens that branch on it
 * are being rewired rather than rewritten, and a connector that locks is meant to return.
 */
export type WalletConnectionStatus = 'disconnected' | 'locked' | 'ready'

/** Which wallet is holding the key. Read only to word a signing step. */
export type WalletSignerType = 'jade' | 'seed' | 'sideswap' | 'humid'

/** A request the person has to finish somewhere else before the dapp can continue. */
export interface PendingWalletRequest {
  kind: 'login' | 'sign'
  requestId: string
  appLink: string | null
}

/** Whether a disconnect keeps or drops what was cached for the account. */
export type CachePolicy = 'preserve' | 'clear'

/**
 * The only way anything in this application reaches a wallet.
 *
 * Everything above this is a screen, and every screen sees the same value whichever wallet is
 * connected. Everything below is one adapter per wallet.
 */
export interface WalletFacadeValue {
  /** Whether a wallet can be reached from this page at all. */
  hasWallet: boolean
  /** Why no wallet can be reached, when none can. Null while one can. */
  walletUnavailableReason: string | null
  connectionStatus: WalletConnectionStatus
  /** Which wallet is connected, or null. */
  connectorId: string | null
  signerType: WalletSignerType | null
  /** The account this dapp is acting as. */
  account: string | null
  isReady: boolean
  /** Whether a session the wallet already holds for this origin is being restored. */
  reconnecting: boolean
  /** Whether a wallet-served read is in flight. */
  syncing: boolean
  /** What the wallet says the account holds, keyed by asset id, in base units. */
  balances: Record<string, string>
  confirmedBalances: Record<string, string>
  pendingBalances: Record<string, string>
  /**
   * Why the balances are not known, when the wallet did not answer for them.
   *
   * Empty balances and unknown balances are different facts and were the same value here: a
   * read that failed left no entries, and a screen that renders a missing entry as zero states
   * that the account holds nothing. Whatever reads a balance reads this beside it.
   */
  balancesUnavailableReason: string | null
  receiveAddress: string | null
  /** The script the account's address pays to — how every read here identifies an account. */
  scriptPubkey: string | null
  pendingRequest: PendingWalletRequest | null
  /** The last failure, kept after it stops being shown. */
  error: string | null
  /** Whether that failure is still worth showing. */
  isError: boolean

  connect(): Promise<void>
  disconnect(options?: { cachePolicy?: CachePolicy }): Promise<void>
  /** Show the wallet's own account view, where an account is inspected and given up. */
  openAccount(): void
  /** Re-read everything the wallet serves about this account. */
  syncWallet(): Promise<void>
  getReceiveAddress(): Promise<string | null>
  /** Perform one protocol action as the connected account. */
  performAction(request: WalletActionRequest): Promise<WalletActionResult>

  /*
   * The in-page signing surface, kept so the action screens still compile while their own
   * issues replace them. Each refuses by name: the wallet holds the descriptor now, so there
   * is no local wallet object, no local output set, and no local signature to hand back.
   */
  getWollet(): Promise<Wollet>
  getBlindedWalletUtxos(): Promise<WalletTxOut[]>
  signPset(pset: Pset): Promise<Pset>
  applyBroadcastTransaction(tx: Transaction): void
}
