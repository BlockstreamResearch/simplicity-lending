import { QueryClient } from '@tanstack/react-query'

import { computeRetryDelay, shouldRetryQuery } from '@/api/retry'

const DEFAULT_STALE_TIME_MS = 30_000

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: shouldRetryQuery,
      retryDelay: computeRetryDelay,
      staleTime: DEFAULT_STALE_TIME_MS,
      refetchOnWindowFocus: true,
    },
    mutations: {
      retry: false,
    },
  },
})
