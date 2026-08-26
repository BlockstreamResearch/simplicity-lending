/**
 * What a transaction builder needs from a wallet, handed to it rather than looked up.
 *
 * The seven builders each read this from the facade's hook, which is where it comes from on a
 * product screen. A wallet that performs an action for itself cannot: an adapter is constructed
 * inside the facade provider's own body, above the context it publishes, so a hook that reads the
 * facade would throw there. It holds the same four members directly, from its own chain session,
 * and hands them over.
 */

import type { Network, WalletTxOut, Wollet } from '@lilbonekit/lwk-web'

export interface ProtocolBuilderAccess {
  readonly lwkNetwork: Network
  /** The chain library's wallet object, which funds, blinds and finalizes the transaction. */
  getWollet(): Promise<Wollet>
  /** The account's outputs, blinded, to select inputs from. */
  getBlindedWalletUtxos(): Promise<WalletTxOut[]>
  /** Where change and anything returned to this account is sent. */
  getReceiveAddress(): Promise<string | null>
  /** Reread the chain, so the outputs selected after this are the ones that still exist. */
  syncWallet(): Promise<void>
  /**
   * Transactions this page has broadcast and not yet seen confirmed.
   *
   * The fee has to beat what is already in the mempool from this wallet, or the new transaction
   * waits behind one it may be replacing.
   */
  readonly processingTxids: readonly string[]
}
