import { isRouteErrorResponse, useRouteError } from 'react-router-dom'

function getErrorMessage(error: unknown) {
  if (isRouteErrorResponse(error)) {
    return error.statusText || error.data || 'Unexpected error'
  }

  if (error instanceof Error) {
    return error.message
  }

  return 'Unexpected error'
}

export default function ErrorBoundary() {
  const error = useRouteError()

  return (
    <main className='mx-auto flex flex-col min-h-screen justify-center w-full max-w-lg'>
      <h1 className='text-2xl font-semibold'>Error</h1>
      <p className='mt-1'>
        An unexpected error has occurred. Please check the details below and try refreshing the
        page.
      </p>
      <pre className='mt-4 overflow-x-auto rounded-lg bg-background p-4 text-sm'>
        {getErrorMessage(error)}
      </pre>
    </main>
  )
}
