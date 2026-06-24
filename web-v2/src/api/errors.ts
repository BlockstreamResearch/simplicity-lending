import type { z as zod } from 'zod'

export class ApiError extends Error {
  readonly status: number | undefined
  readonly body: string | undefined
  readonly cause: unknown
  constructor(message: string, options: { status?: number; body?: string; cause?: unknown } = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = options.status
    this.body = options.body
    this.cause = options.cause
  }
}

export class ApiValidationError extends ApiError {
  readonly issues: zod.ZodIssue[]
  constructor(message: string, issues: zod.ZodIssue[]) {
    super(message)
    this.name = 'ApiValidationError'
    this.issues = issues
  }
}

export class ApiTimeoutError extends ApiError {
  constructor(message = 'Request timed out', options: { cause?: unknown } = {}) {
    super(message, options)
    this.name = 'ApiTimeoutError'
  }
}

export class ApiAbortError extends ApiError {
  constructor(message = 'Request aborted', options: { cause?: unknown } = {}) {
    super(message, options)
    this.name = 'ApiAbortError'
  }
}

export class BroadcastError extends ApiError {
  constructor(message: string, options: { status?: number; body?: string; cause?: unknown } = {}) {
    super(message, options)
    this.name = 'BroadcastError'
  }
}
