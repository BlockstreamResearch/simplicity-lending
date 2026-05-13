import { toast } from '@heroui/react'

import { ApiAbortError, ApiError, ApiTimeoutError, ApiValidationError } from '@/api/errors'

export class ErrorHandler {
  static process(error: unknown, message?: string): void {
    if (error instanceof ApiAbortError) return

    const description =
      message ?? (error instanceof Error ? ErrorHandler.getErrorMessage(error) : String(error))

    toast.danger('Error', { description })

    ErrorHandler.processWithoutFeedback(error)
  }

  static processWithoutFeedback(error: unknown): void {
    console.error(error)
  }

  private static getErrorMessage(error: Error): string {
    if (error instanceof ApiTimeoutError) {
      return 'Request timed out. Please try again.'
    }
    if (error instanceof ApiValidationError) {
      return 'Server returned unexpected data. Please try again later.'
    }
    if (error instanceof ApiError) {
      return ErrorHandler.getApiErrorMessage(error)
    }
    return error.message || 'Unexpected error occurred.'
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
