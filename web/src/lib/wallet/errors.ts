/**
 * The failure vocabulary of the wallet facade.
 *
 * Every wallet failure is raised here and nowhere else, so a screen never has to know which
 * wallet it was talking to in order to say what went wrong. Raising is separate from showing:
 * these carry what happened, and the presentation decides what a person reads.
 */

/** No wallet can be reached from this page — nothing is injected, or this build has no chain. */
export class WalletUnavailableError extends Error {
  override readonly name = 'WalletUnavailableError'

  constructor(reason: string) {
    super(reason)
  }
}

/** The wallet refused the connection, or the person walked away from the approval. */
export class WalletConnectionRefusedError extends Error {
  override readonly name = 'WalletConnectionRefusedError'

  constructor(message = 'The wallet did not approve the connection.', options?: ErrorOptions) {
    super(message, options)
  }
}

/** Something asked to act as an account while nothing was connected. */
export class WalletNotConnectedError extends Error {
  override readonly name = 'WalletNotConnectedError'

  constructor(what: string) {
    super(`Connect a wallet before ${what}.`)
  }
}

/**
 * The connected wallet cannot do this yet.
 *
 * A capability the facade declares but no adapter serves fails here, by name, immediately. The
 * alternative — a call that never settles — is the same outcome with nothing to read.
 */
export class WalletCapabilityUnavailableError extends Error {
  override readonly name = 'WalletCapabilityUnavailableError'

  constructor(capability: string, reason: string) {
    super(`The connected wallet cannot ${capability} yet. ${reason}`)
  }
}

/**
 * The wallet performed an action and answered with something there is no transaction in.
 *
 * Raised rather than reported as a success with an empty id: everything downstream — the toast,
 * the pending list, the explorer link, the indexer read that follows — is keyed on a transaction
 * id, and an empty one would follow a transaction nobody can find.
 */
export class WalletActionIncompleteError extends Error {
  override readonly name = 'WalletActionIncompleteError'

  constructor(action: string) {
    super(`The wallet answered "${action}" with no transaction id, so there is nothing to follow.`)
  }
}

/**
 * What a person reads when a wallet call failed, from whatever was thrown.
 *
 * The errors above are written as product copy and are used as they stand. Anything else came
 * from the wallet or from the transport and is not written for a reader, so it is named rather
 * than quoted: what was being done, and that the wallet did not answer. The original text is
 * kept as the second half so a person reporting the failure has something to report, which is
 * the whole reason this is not swallowed.
 */
export function describeWalletFailure(error: unknown, what: string): string {
  if (
    error instanceof WalletUnavailableError ||
    error instanceof WalletNotConnectedError ||
    error instanceof WalletCapabilityUnavailableError ||
    error instanceof WalletConnectionRefusedError ||
    error instanceof WalletActionIncompleteError
  ) {
    return error.message
  }

  const detail = error instanceof Error ? error.message : String(error)

  return `The wallet did not answer when asked to ${what}. It said: ${detail}`
}
