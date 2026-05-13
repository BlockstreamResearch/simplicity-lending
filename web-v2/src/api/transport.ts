import type { z } from 'zod'

import { ErrorHandler } from '@/utils/errorHandler'

import { ApiAbortError, ApiError, ApiTimeoutError, ApiValidationError } from './errors'

export const DEFAULT_TIMEOUT_MS = 30_000

export interface RequestOptions {
  method?: RequestInit['method']
  body?: BodyInit
  headers?: Record<string, string>
  signal?: AbortSignal
  timeoutMs?: number
}

export interface RequestParams {
  signal?: AbortSignal
}

type ResponseFormat = 'json' | 'text' | 'bytes'

async function readErrorBody(response: Response): Promise<string> {
  try {
    const contentType = response.headers.get('content-type')
    if (contentType?.includes('application/json')) {
      return JSON.stringify(await response.json())
    }
    return await response.text()
  } catch {
    return ''
  }
}

/**
 * Merge caller's cancellation signal with internal timeout signal.
 * Either aborting cancels the fetch. `AbortSignal.any` auto-removes listeners on first abort,
 * so no manual cleanup is needed.
 */
function combineSignals(callerSignal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  return callerSignal ? AbortSignal.any([callerSignal, timeoutSignal]) : timeoutSignal
}

async function readResponseAs(response: Response, format: ResponseFormat): Promise<unknown> {
  if (format === 'bytes') return new Uint8Array(await response.arrayBuffer())
  if (format === 'text') return (await response.text()).trim()
  return (await response.json()) as unknown
}

/**
 * Distinguish caller-initiated cancellation from internal timeout.
 * - `TimeoutError` is thrown by `AbortSignal.timeout` directly.
 * - `AbortError` is generic — could be caller OR the internal timeout signal triggering parent.
 *   We disambiguate by checking which signal is `aborted`: if caller signal is aborted, it was
 *   caller-initiated; otherwise the timeout fired.
 * Different error classes let UI/retry logic react differently (e.g. don't toast on caller cancel).
 */
function classifyAbortError(
  error: unknown,
  callerSignal: AbortSignal | undefined,
): ApiError | null {
  if (!(error instanceof DOMException)) return null
  if (error.name === 'TimeoutError') return new ApiTimeoutError(undefined, { cause: error })
  if (error.name === 'AbortError') {
    return callerSignal?.aborted
      ? new ApiAbortError(undefined, { cause: error })
      : new ApiTimeoutError(undefined, { cause: error })
  }
  return null
}

async function rawRequest(
  url: string,
  format: ResponseFormat,
  options: RequestOptions,
): Promise<unknown> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  try {
    const response = await fetch(url, {
      method: options.method ?? 'GET',
      headers: options.headers,
      body: options.body,
      signal: combineSignals(options.signal, timeoutMs),
    })
    if (!response.ok) {
      const body = await readErrorBody(response)
      throw new ApiError(`API error: ${response.status} ${response.statusText}`, {
        status: response.status,
        body,
      })
    }
    return await readResponseAs(response, format)
  } catch (error) {
    // Order matters: pass through our own ApiError untouched, classify abort/timeout next,
    // wrap unknown errors (network failure, JSON parse error) into generic ApiError last.
    if (error instanceof ApiError) throw error
    const classified = classifyAbortError(error, options.signal)
    if (classified) throw classified
    throw new ApiError(error instanceof Error ? error.message : String(error), { cause: error })
  }
}

/**
 * Validate raw payload against a Zod schema. Shared between `requestJson` and the
 * schema-variant of `requestText` overload — kept here to avoid duplicating the error path.
 * Validation failures are reported via ErrorHandler (no toast — silent log) and rethrown
 * as `ApiValidationError`, which `shouldRetryQuery` excludes from retries.
 */
function parseWithSchema<Schema extends z.ZodTypeAny>(
  schema: Schema,
  raw: unknown,
  url: string,
): z.output<Schema> {
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    const validationError = new ApiValidationError(
      `Response validation failed for ${url}: ${parsed.error.message}`,
      parsed.error.issues,
    )
    ErrorHandler.processWithoutFeedback(validationError)
    throw validationError
  }
  return parsed.data
}

export async function requestJson<Schema extends z.ZodTypeAny>(
  url: string,
  schema: Schema,
  options: RequestOptions = {},
): Promise<z.output<Schema>> {
  const raw = await rawRequest(url, 'json', options)
  return parseWithSchema(schema, raw, url)
}

/**
 * Two-mode text fetcher via TypeScript overloads:
 *   1. `requestText(url, options?)` → raw `Promise<string>`
 *   2. `requestText(url, schema, options?)` → `Promise<z.output<Schema>>` after Zod validation
 * Implementation distinguishes modes at runtime by duck-typing `safeParse` on the second arg.
 * Lets one transport entry-point serve both "plain text" and "parsed text" callers without
 * exposing a second function name.
 */
export function requestText(url: string, options?: RequestOptions): Promise<string>
export function requestText<Schema extends z.ZodTypeAny>(
  url: string,
  schema: Schema,
  options?: RequestOptions,
): Promise<z.output<Schema>>
export async function requestText<Schema extends z.ZodTypeAny>(
  url: string,
  schemaOrOptions?: Schema | RequestOptions,
  maybeOptions?: RequestOptions,
): Promise<string | z.output<Schema>> {
  const hasSchema =
    schemaOrOptions !== undefined &&
    typeof (schemaOrOptions as { safeParse?: unknown }).safeParse === 'function'
  const schema = hasSchema ? (schemaOrOptions as Schema) : undefined
  const options = hasSchema ? (maybeOptions ?? {}) : ((schemaOrOptions as RequestOptions) ?? {})
  const raw = await rawRequest(url, 'text', options)
  if (!schema) return raw as string
  return parseWithSchema(schema, raw, url)
}

export async function requestBytes(url: string, options: RequestOptions = {}): Promise<Uint8Array> {
  return rawRequest(url, 'bytes', options) as Promise<Uint8Array>
}
