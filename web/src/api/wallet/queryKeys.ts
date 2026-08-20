/**
 * Every read served by the connected wallet, keyed by the account it was read as.
 *
 * The account is part of every key on purpose: a balance belongs to an account, so switching
 * accounts must miss the cache rather than show the previous one's number under a new name.
 */
export const walletQueryKeys = {
  all: () => ['wallet'] as const,
  balances: (account: string | null, assetIds: readonly string[]) =>
    ['wallet', 'balances', account, [...assetIds].sort().join(',')] as const,
  utxos: (account: string | null, assetId: string) =>
    ['wallet', 'utxos', account, assetId] as const,
} as const
