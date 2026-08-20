export interface HumidContextValue {
  /**
   * Whether the humid extension has put its provider on the page. A content script
   * injects it a tick after load, so this starts false on a fresh render and turns true
   * on its own — it is not a verdict until the poll has given up.
   */
  hasExtension: boolean
  /** Whether this origin currently holds an approved session with an account in it. */
  isConnected: boolean
  /** The Liquid account this dapp is acting as, or null when nothing is connected. */
  account: string | null
  /** True from the moment the approval is asked for until the wallet answers either way. */
  connecting: boolean
  /**
   * Ask the wallet to approve a session, resolving once an account is connected and
   * rejecting when the wallet refuses or the person walks away from the approval.
   *
   * The rejection is the whole report of a failure — nothing keeps a second copy of it in
   * state, because the wallet's own approval window is what a person is looking at when it
   * happens and it says so there.
   */
  connect(): Promise<void>
  /** Drop this origin's session. The wallet forgets the approval; nothing local survives it. */
  disconnect(): Promise<void>
  /** Show the wallet's own account view — where the account is inspected and dropped. */
  openAccount(): void
}
