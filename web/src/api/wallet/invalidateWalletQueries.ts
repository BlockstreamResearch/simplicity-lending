import type { QueryClient } from '@tanstack/react-query'

import { walletQueryKeys } from './queryKeys'

/**
 * Drop every wallet-served read.
 *
 * Called when the account changes and after an action moves money, because both make what the
 * wallet last said about this account untrue rather than merely old.
 */
export function invalidateAllWalletQueries(queryClient: QueryClient): void {
  queryClient.invalidateQueries({ queryKey: walletQueryKeys.all() })
}
