import axios, { AxiosError, type AxiosRequestConfig } from 'axios'
import type { z } from 'zod'

import { ErrorHandler } from '@/utils/errorHandler'

import { ApiAbortError, ApiError, ApiTimeoutError, ApiValidationError } from './errors'

export const DEFAULT_TIMEOUT_MS = 30_000

export interface RequestParams {
  signal?: AbortSignal
}

const apiClient = axios.create({ timeout: DEFAULT_TIMEOUT_MS })

apiClient.interceptors.response.use(undefined, (error: AxiosError) =>
  Promise.reject(toApiError(error)),
)

function toApiError(error: AxiosError): ApiError {
  if (error.code === AxiosError.ECONNABORTED || error.code === AxiosError.ETIMEDOUT) {
    return new ApiTimeoutError(undefined, { cause: error })
  }
  if (error.code === AxiosError.ERR_CANCELED) {
    return new ApiAbortError(undefined, { cause: error })
  }
  if (error.response) {
    const { status, statusText, data } = error.response
    const body = typeof data === 'string' ? data : safeStringify(data)
    return new ApiError(`API error: ${status} ${statusText}`, { status, body, cause: error })
  }
  return new ApiError(error.message, { cause: error })
}

function safeStringify(data: unknown): string {
  if (data === null || data === undefined) return ''
  try {
    return JSON.stringify(data)
  } catch {
    return String(data)
  }
}

function parseWithSchema<Schema extends z.ZodTypeAny>(
  data: unknown,
  schema: Schema,
  url: string,
): z.output<Schema> {
  const parsed = schema.safeParse(data)
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

function isZodSchema(value: unknown): value is z.ZodTypeAny {
  return typeof (value as { safeParse?: unknown } | undefined)?.safeParse === 'function'
}

export async function requestJson<Schema extends z.ZodTypeAny>(
  url: string,
  schema: Schema,
  config?: AxiosRequestConfig,
): Promise<z.output<Schema>> {
  const { data } = await apiClient.request<unknown>({ ...config, url })
  return parseWithSchema(data, schema, url)
}

export function requestText(url: string, config?: AxiosRequestConfig): Promise<string>
export function requestText<Schema extends z.ZodTypeAny>(
  url: string,
  schema: Schema,
  config?: AxiosRequestConfig,
): Promise<z.output<Schema>>
export async function requestText<Schema extends z.ZodTypeAny>(
  url: string,
  schemaOrConfig?: Schema | AxiosRequestConfig,
  maybeConfig?: AxiosRequestConfig,
): Promise<string | z.output<Schema>> {
  const schema = isZodSchema(schemaOrConfig) ? schemaOrConfig : undefined
  const config = schema ? maybeConfig : (schemaOrConfig as AxiosRequestConfig | undefined)
  const { data } = await apiClient.request<string>({ ...config, url, responseType: 'text' })
  const text = typeof data === 'string' ? data.trim() : ''
  return schema ? parseWithSchema(text, schema, url) : text
}

export async function requestBytes(url: string, config?: AxiosRequestConfig): Promise<Uint8Array> {
  const { data } = await apiClient.request<ArrayBuffer>({
    ...config,
    url,
    responseType: 'arraybuffer',
  })
  return new Uint8Array(data)
}
