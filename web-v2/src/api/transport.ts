import axios, { AxiosError, type AxiosRequestConfig } from 'axios'
import type { z } from 'zod'

import { ErrorHandler } from '@/utils/errorHandler'

import { ApiAbortError, ApiError, ApiTimeoutError, ApiValidationError } from './errors'

export const DEFAULT_TIMEOUT_MS = 30_000

export interface RequestParams {
  signal?: AbortSignal
}

export const apiClient = axios.create({ timeout: DEFAULT_TIMEOUT_MS })

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

export function parseWithSchema<Schema extends z.ZodTypeAny>(
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

export async function requestJson<Schema extends z.ZodTypeAny>(
  url: string,
  schema: Schema,
  config?: AxiosRequestConfig,
): Promise<z.output<Schema>> {
  const { data } = await apiClient.request<unknown>({ ...config, url })
  return parseWithSchema(data, schema, url)
}
