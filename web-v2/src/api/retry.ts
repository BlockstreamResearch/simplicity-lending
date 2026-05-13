import { ApiError, ApiValidationError } from './errors'

export const MAX_RETRY_ATTEMPTS = 3

const BASE_DELAY_MS = 1_000
const MAX_DELAY_MS = 30_000
const JITTER_MAX_MS = 500

export function computeRetryDelay(attemptIndex: number): number {
  const exponentialDelay = Math.min(BASE_DELAY_MS * 2 ** attemptIndex, MAX_DELAY_MS)
  const jitter = Math.random() * JITTER_MAX_MS
  return exponentialDelay + jitter
}

function isRetryableError(error: unknown): boolean {
  if (!(error instanceof ApiError) || error instanceof ApiValidationError) return false
  const { status } = error
  return status === undefined || status === 408 || status === 429 || status >= 500
}

export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (failureCount >= MAX_RETRY_ATTEMPTS) return false
  return isRetryableError(error)
}
