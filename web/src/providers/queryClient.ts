import { QueryClient } from '@tanstack/react-query'

import { ApiError, ApiValidationError } from '@/api/errors'

const DEFAULT_STALE_TIME_MS = 30_000
const MAX_RETRY_ATTEMPTS = 3
const BASE_RETRY_DELAY_MS = 1_000
const MAX_RETRY_DELAY_MS = 30_000
const RETRY_JITTER_MAX_MS = 500

function isRetryableError(error: unknown): boolean {
  if (!(error instanceof ApiError) || error instanceof ApiValidationError) return false
  const { status } = error
  return status === undefined || status === 408 || status === 429 || status >= 500
}

function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  return failureCount < MAX_RETRY_ATTEMPTS && isRetryableError(error)
}

function computeRetryDelay(attemptIndex: number): number {
  const exponentialDelay = Math.min(BASE_RETRY_DELAY_MS * 2 ** attemptIndex, MAX_RETRY_DELAY_MS)
  const jitter = Math.random() * RETRY_JITTER_MAX_MS
  return exponentialDelay + jitter
}

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
