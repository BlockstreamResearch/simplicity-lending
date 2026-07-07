import { toast } from '@heroui/react'

import {
  ApiAbortError,
  ApiError,
  ApiTimeoutError,
  ApiValidationError,
  BroadcastError,
} from '@/api/errors'
import { NETWORK_CONFIG } from '@/constants/network-config'
import { formatAmount, formatFeeReserve } from '@/utils/format'

const INSUFFICIENT_ASSET_RE =
  /Insufficient funds:\s*missing\s+([\d,]+)\s+units\s+for asset\s+([0-9a-f]{64})/i

function describeInsufficientAsset(message: string): string | null {
  const match = message.match(INSUFFICIENT_ASSET_RE)
  if (!match) return null

  const amount = BigInt(match[1].replaceAll(',', ''))
  const assetId = match[2].toLowerCase()
  if (assetId === NETWORK_CONFIG.collateralAsset.id.toLowerCase()) {
    return `Insufficient L-BTC balance: missing ${formatFeeReserve(amount)}.`
  }

  const asset = [NETWORK_CONFIG.principalAsset, NETWORK_CONFIG.protocolFeeAsset].find(
    candidate => candidate.id.toLowerCase() === assetId,
  )
  if (asset) {
    return `Insufficient ${asset.symbol} balance: missing ${formatAmount(amount, asset.decimals)} ${asset.symbol}.`
  }

  return null
}

export class ErrorHandler {
  static process(error: unknown, message?: string): void {
    if (error instanceof ApiAbortError) return

    const description =
      message ?? (error instanceof Error ? ErrorHandler.getErrorMessage(error) : String(error))

    toast.danger('Error', { description })

    ErrorHandler.processWithoutFeedback(error)
  }

  static processWithRetry(error: unknown, onRetry: () => void, message?: string): void {
    if (error instanceof ApiAbortError) return

    const description =
      message ?? (error instanceof Error ? ErrorHandler.getErrorMessage(error) : String(error))

    toast.danger('Error', {
      description,
      actionProps: { children: 'Retry', onPress: onRetry },
    })

    ErrorHandler.processWithoutFeedback(error)
  }

  static processWithoutFeedback(error: unknown): void {
    console.error(error)
  }

  static describe(error: unknown): string {
    if (error instanceof Error) return ErrorHandler.getErrorMessage(error)
    if (typeof error === 'string' && error.trim()) return error
    return 'Unexpected error occurred.'
  }

  private static getErrorMessage(error: Error): string {
    if (error instanceof ApiTimeoutError) {
      return 'Request timed out. Please try again.'
    }
    if (error instanceof ApiValidationError) {
      return 'Server returned unexpected data. Please try again later.'
    }
    if (error instanceof BroadcastError) {
      return error.message
    }
    if (error instanceof ApiError) {
      return ErrorHandler.getApiErrorMessage(error)
    }
    const message = error.message || 'Unexpected error occurred.'
    return describeInsufficientAsset(message) ?? message
  }

  private static getApiErrorMessage(error: ApiError): string {
    switch (error.status) {
      case 400:
        return "Something doesn't look right. Please double-check your input."
      case 401:
        return "You're not signed in or your session has expired."
      case 403:
        return "You don't have access to perform this action."
      case 404:
        return "We couldn't find what you're looking for."
      case 409:
        return 'This action conflicts with an existing record. Please try again.'
      case 429:
        return 'Too many requests. Please slow down and try again.'
      default:
        if (error.status !== undefined && error.status >= 500) {
          return 'Something went wrong on our side. Please try again in a moment.'
        }
        return error.message || 'Unexpected error occurred.'
    }
  }
}
