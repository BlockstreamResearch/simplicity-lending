/**
 * What a wallet has to provide to stand behind the facade.
 *
 * This is the whole contract. Adding a wallet to this dapp is writing one of these; nothing
 * above the facade names a wallet, and nothing below it names a screen.
 */

import type { Pset, Transaction, WalletTxOut, Wollet } from '@lilbonekit/lwk-web'

/**
 * Where a connection attempt has got to.
 *
 * `locked` is a device that has been reached and is waiting for its PIN. It is not a wallet that
 * is disconnected — the person is doing something, and a screen that showed nothing would be
 * telling them it had failed.
 */
export type WalletConnectionState =
  | 'unavailable'
  | 'disconnected'
  | 'connecting'
  | 'locked'
  | 'connected'

/**
 * Which wallet is holding the key, in the vocabulary the screens already read.
 *
 * Read to word a signing step — a device asks for a button press and a software signer does not —
 * so it is the adapter's own answer rather than a guess made from the connector id.
 */
export type WalletSignerType = 'jade' | 'seed' | 'sideswap' | 'humid'

/**
 * Which addresses an account hands out: native segwit, or nested segwit.
 *
 * The same two values as `WalletType` in the superseded wallet layer, restated rather than
 * imported: importing it would put that layer back on the path from the entry, which is the one
 * thing the seam test exists to notice. The adapter that needs it maps this to its own.
 */
export type WalletVariant = 'Wpkh' | 'ShWpkh'

/**
 * What a wallet needs from the person before it can start, beyond the press of the button.
 *
 * Each wallet reads the one thing it needs and ignores the rest: a software signer needs a
 * recovery phrase, a device needs to be told which kind of address to derive, and a remote wallet
 * needs to know whether this is a fresh login or the resumption of a session it already holds.
 */
export interface WalletConnectOptions {
  /** The recovery phrase a software signer is built from. */
  mnemonic?: string
  variant?: WalletVariant
  /** Reattach to a session that is still live, and never start a fresh login request. */
  resumeOnly?: boolean
}

/** Whether a disconnect keeps or drops what was cached for the account. */
export type CachePolicy = 'preserve' | 'clear'

/**
 * Something a person has to finish somewhere else before this dapp can go on.
 *
 * A wallet in another application is not slow, it is waiting for someone. Saying which request is
 * outstanding, and where it can be answered, is what lets a screen show that rather than a
 * spinner that never ends.
 */
export interface PendingWalletRequest {
  kind: 'login' | 'sign'
  requestId: string
  /** A link that opens the wallet on this request, where the wallet publishes one. */
  appLink: string | null
}

/** The account this dapp acts as. */
export interface WalletAccount {
  /** The Liquid address the wallet authorised for this origin. */
  address: string
  /** CAIP-2 id of the chain the account is scoped to. */
  chainId: string
}

/**
 * What an account holds of one asset, as the wallet reports it.
 *
 * A wallet that scans the chain itself knows what has confirmed and what has not; one that answers
 * from inside an extension may report a single number and nothing about its parts. Those are
 * different answers and this keeps them apart: `null` is "this wallet does not say", which is not
 * the same as zero. A screen that reads a confirmed balance is deciding whether an action can be
 * funded, and money that has not confirmed cannot fund one.
 */
export interface WalletAssetBalance {
  /** Everything the account holds of this asset, in base units. */
  total: string
  /** What of it has confirmed. Null where the wallet does not distinguish. */
  confirmed: string | null
  /** What of it has not confirmed yet. Null where the wallet does not distinguish. */
  pending: string | null
}

/** One spendable output the wallet holds, in the facade's own terms. */
export interface WalletUtxo {
  txid: string
  vout: number
  assetId: string
  /** Base units, as a string, because a Liquid amount does not fit a JavaScript number. */
  amount: string
  address: string
  scriptPubkey: string
  confidential: boolean
  spendable: boolean
}

/**
 * One protocol action, as the wallet's own request.
 *
 * Deliberately unshaped. The wallet's request has no published dapp-facing type yet — the
 * vendored client says so at `appkit-injected-adapter/liquid-rpc.ts` — and inventing one here
 * would settle by guess what the action work is about to establish by delivery.
 */
export type WalletActionRequest = Record<string, unknown>

/** What the wallet answers an action with. Narrowed when the request shape is settled. */
export type WalletActionResult = unknown

/** Everything performed as the connected account. Each one refuses by name when unserved. */
export interface WalletCapabilities {
  /**
   * The public descriptor the person approved for this account, in a confidential form the
   * chain library can hand out addresses from.
   *
   * The wallet names an account by an identifier rather than by an address, so this is where an
   * address comes from at all.
   */
  getWalletDescriptor(): Promise<string>
  /** What this account holds of one asset, and what of it has confirmed where that is known. */
  getBalance(assetId: string): Promise<WalletAssetBalance>
  /** The outputs the wallet will spend for one asset. */
  getUtxos(assetId: string): Promise<WalletUtxo[]>
  /** Build, check, sign and send one protocol action. */
  performAction(request: WalletActionRequest): Promise<WalletActionResult>

  /*
   * What a wallet whose outputs this page can see also serves.
   *
   * Optional, and optional is the point: a wallet that holds the descriptor itself builds and
   * signs inside itself, and has no wallet object, no output set and no local signature to hand
   * back. Each one it does not serve is refused by name by the facade, which is the same answer
   * the facade used to give for every wallet — kept, rather than replaced by a call that never
   * settles or an empty list that reads as an account holding nothing.
   */

  /** The chain library's own wallet object, which a transaction builder funds and blinds from. */
  getWollet?(): Promise<Wollet>
  /**
   * The outputs, still blinded, as the chain library hands them out.
   *
   * Not `getUtxos`: a builder unblinds these itself to select inputs, and the plain description
   * `getUtxos` returns cannot be unblinded or spent.
   */
  getBlindedWalletUtxos?(): Promise<WalletTxOut[]>
  /** Where this account receives, when the wallet serves a descriptor an address comes from. */
  getReceiveAddress?(): Promise<string | null>
  /**
   * Rescan the chain and take up what it found.
   *
   * What every builder means when it syncs before selecting inputs. A wallet that keeps its own
   * output set has to reread the chain here, because the alternative is selecting inputs from a
   * set that has been spent from since it was read.
   */
  rescan?(): Promise<void>
  /** Sign a transaction this page built, with the key this wallet holds. */
  signPset?(pset: Pset): Promise<Pset>
  /**
   * Take up a transaction that has just been broadcast, without waiting for a scan to find it.
   *
   * Best effort by nature: the transaction is already sent whatever happens here.
   */
  applyBroadcastTransaction?(tx: Transaction): void
}

/** One wallet, as the facade sees it. */
export interface WalletAdapter {
  /** Stable identity, e.g. `humid`. Shown to nobody; used to say which wallet is connected. */
  readonly id: string
  /** Which wallet holds the key, for the screens that word themselves differently per wallet. */
  readonly signerType: WalletSignerType
  /** Name a person would recognise. */
  readonly name: string
  /** Whether this wallet can be reached from this page at all. */
  readonly isAvailable: boolean
  /** Why it cannot be reached, when it cannot. Null while it can. */
  readonly unavailableReason: string | null
  readonly state: WalletConnectionState
  readonly account: WalletAccount | null
  /** Whether a session is being restored from an approval this origin already holds. */
  readonly restoring: boolean
  /**
   * Whether the device this wallet lives on is plugged in, for a wallet that lives on one.
   *
   * The unlock modal is dismissed by unplugging as much as by entering the PIN, so this is the
   * difference between waiting for a person and waiting for nothing.
   */
  readonly usbDeviceDetected?: boolean
  /** Which kind of address this account hands out, where the wallet was told rather than asked. */
  readonly variant?: WalletVariant
  /**
   * How many times this wallet has taken up something new from the chain on its own.
   *
   * A wallet that scans keeps looking while the tab is open, and what it finds is not the answer to
   * any question a screen asked. The number means nothing; that it changed means the answers have
   * moved, and whatever is showing them has to ask again.
   */
  readonly chainUpdates?: number
  /**
   * Whether starting this wallet needs a recovery phrase from the person.
   *
   * Declared by the wallet rather than assumed by the screen, so the picker knows to ask for one
   * without knowing which wallet it is asking for — and stops asking when a build already carries
   * one.
   */
  readonly requiresRecoveryPhrase?: boolean
  /** What this wallet is waiting for a person to answer elsewhere, when it is waiting. */
  readonly pendingRequest?: PendingWalletRequest | null
  /** Give up on that request. Only a wallet that can be kept waiting serves this. */
  cancelPendingRequest?(): Promise<void>
  /**
   * Ask for an approved session. Resolves once an account is connected, rejects otherwise.
   *
   * What one wallet needs to start is nothing another needs, so what the person supplied is
   * carried whole and each adapter takes what applies to it.
   */
  connect(options?: WalletConnectOptions): Promise<void>
  /**
   * Give up this origin's session.
   *
   * A wallet that caches a scanned chain for this account is told whether to keep it. Keeping it
   * is what makes a reconnect cheap; dropping it is what "forget this account" has to mean.
   */
  disconnect(options?: { cachePolicy?: CachePolicy }): Promise<void>
  /** Show the wallet's own account view, where an account is inspected and given up. */
  openAccount(): void
  readonly capabilities: WalletCapabilities
}
