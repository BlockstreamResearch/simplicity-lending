/**
 * What a wallet has to provide to stand behind the facade.
 *
 * This is the whole contract. Adding a wallet to this dapp is writing one of these; nothing
 * above the facade names a wallet, and nothing below it names a screen.
 */

/** Where a connection attempt has got to. */
export type WalletConnectionState = 'unavailable' | 'disconnected' | 'connecting' | 'connected'

/** The account this dapp acts as. */
export interface WalletAccount {
  /** The Liquid address the wallet authorised for this origin. */
  address: string
  /** CAIP-2 id of the chain the account is scoped to. */
  chainId: string
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
  /** What the wallet says this account holds of one asset, in base units. */
  /**
   * The public descriptor the person approved for this account, in a confidential form the
   * chain library can hand out addresses from.
   *
   * The wallet names an account by an identifier rather than by an address, so this is where an
   * address comes from at all.
   */
  getWalletDescriptor(): Promise<string>
  getBalance(assetId: string): Promise<string>
  /** The outputs the wallet will spend for one asset. */
  getUtxos(assetId: string): Promise<WalletUtxo[]>
  /** Build, check, sign and send one protocol action. */
  performAction(request: WalletActionRequest): Promise<WalletActionResult>
}

/** One wallet, as the facade sees it. */
export interface WalletAdapter {
  /** Stable identity, e.g. `humid`. Shown to nobody; used to say which wallet is connected. */
  readonly id: string
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
  /** Ask for an approved session. Resolves once an account is connected, rejects otherwise. */
  connect(): Promise<void>
  /** Give up this origin's session. */
  disconnect(): Promise<void>
  /** Show the wallet's own account view, where an account is inspected and given up. */
  openAccount(): void
  readonly capabilities: WalletCapabilities
}
