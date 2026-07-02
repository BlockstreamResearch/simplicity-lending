import { isRouteErrorResponse, useRouteError } from 'react-router-dom'

import { ErrorScreen } from '@/components/ErrorScreen'
import { ErrorHandler } from '@/utils/errorHandler'

function describeRouteError(error: unknown): { title: string; description: string } {
  if (isRouteErrorResponse(error)) {
    const description =
      typeof error.data === 'string' && error.data.trim()
        ? error.data
        : error.statusText || 'Unexpected error'
    return { title: `Error ${error.status}`, description }
  }
  return { title: 'Something went wrong', description: ErrorHandler.describe(error) }
}

export default function ErrorBoundary() {
  const error = useRouteError()
  const { title, description } = describeRouteError(error)

  return <ErrorScreen title={title} description={description} />
}
