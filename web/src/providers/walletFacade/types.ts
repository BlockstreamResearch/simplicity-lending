import type { Pset, Transaction, WalletTxOut, Wollet } from '@lilbonekit/lwk-web'

import type {
  CachePolicy,
  PendingWalletRequest,
  WalletActionRequest,
  WalletActionResult,
  WalletConnectOptions,
  WalletSignerType,
  WalletVariant,
} from '@/lib/wallet/types'

export type {
  CachePolicy,
  PendingWalletRequest,
  WalletConnectOptions,
  WalletSignerType,
  WalletVariant,
} from '@/lib/wallet/types'

/**
 * How far the connection has got, in the vocabulary the screens already read.
 *
 * `locked` belongs to a device that has been reached and is waiting for its PIN. A screen that
 * treated it as disconnected would be telling a person their device had failed while they were
 * still typing on it.
 */
export type WalletConnectionStatus = 'disconnected' | 'locked' | 'ready'

/**
 * One wallet the person may pick, and whether they may pick it here.
 *
 * Availability is per wallet because it is a fact about each one separately: an extension that is
 * not installed says nothing about a build that carries no relay URL. Reported as one flag, the
 * picker could only offer all of them or none.
 */
export interface WalletChoice {
  readonly id: string
  /** Name a person would recognise. */
  readonly name: string
  readonly isAvailable: boolean
  /** Why this wallet cannot be reached from this page, when it cannot. Null while it can. */
  readonly unavailableReason: string | null
  /** Whether starting it needs a recovery phrase from the person. */
  readonly requiresRecoveryPhrase: boolean
}

/**
 * The only way anything in this application reaches a wallet.
 *
 * Everything above this is a screen, and every screen sees the same value whichever wallet is
 * connected. Everything below is one adapter per wallet.
 */
export interface WalletFacadeValue {
  /** Every wallet this dapp can act through, and whether each is reachable from this page. */
  wallets: readonly WalletChoice[]
  connectionStatus: WalletConnectionStatus
  /**
   * Which wallet the dapp is acting through, or null while it is acting through none.
   *
   * Set from the moment one is picked rather than from the moment it answers, because a wallet
   * that is waiting for a PIN is the one a retry has to go back to.
   */
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
  /** Whether the device the connected wallet lives on is plugged in. False for one that has none. */
  usbDeviceDetected: boolean
  /** Which kind of address the connected account hands out, where the wallet was told. */
  walletVariant: WalletVariant | null
  /** The last failure, kept after it stops being shown. */
  error: string | null
  /** Whether that failure is still worth showing. */
  isError: boolean

  /**
   * Connect the wallet the person picked, with whatever that wallet needs to start.
   *
   * The wallet is named by the caller because only the person choosing knows which one they
   * pressed. Nothing here defaults to a wallet: a connect with no wallet named is a bug in the
   * screen that called it, not a reason to pick one on their behalf.
   */
  connect(walletId: string, options?: WalletConnectOptions): Promise<void>
  disconnect(options?: { cachePolicy?: CachePolicy }): Promise<void>
  /** Show the wallet's own account view, where an account is inspected and given up. */
  openAccount(): void
  /**
   * Give up on a request the wallet is waiting for a person to answer elsewhere.
   *
   * Resolves without doing anything where nothing is waiting, so a screen offering it does not
   * have to know which wallet is connected.
   */
  cancelPendingRequest(): Promise<void>
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
