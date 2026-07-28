import type { QueryClient } from '@tanstack/react-query'

import { borrowerQueryKeys, factoryQueryKeys, lenderQueryKeys, offersQueryKeys } from './queryKeys'

export function invalidateAllIndexerQueries(queryClient: QueryClient): void {
  const roots = [
    offersQueryKeys.all(),
    borrowerQueryKeys.all(),
    lenderQueryKeys.all(),
    factoryQueryKeys.all(),
  ]
  for (const queryKey of roots) {
    queryClient.invalidateQueries({ queryKey })
  }
}
