import { Component, type ErrorInfo, type PropsWithChildren, type ReactNode } from 'react'

import { ErrorHandler } from '@/utils/errorHandler'

interface AppErrorBoundaryState {
  error: Error | null
}

export class AppErrorBoundary extends Component<PropsWithChildren, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = {
    error: null,
  }

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    ErrorHandler.processWithoutFeedback({ error, errorInfo })
  }

  render(): ReactNode {
    if (!this.state.error) {
      return this.props.children
    }

    return (
      <main className='mx-auto flex min-h-screen w-full max-w-lg flex-col justify-center px-4'>
        <h1 className='text-2xl font-semibold'>Application error</h1>
        <p className='mt-2 text-sm text-gray-600'>
          Something broke while rendering the app. Refresh the page to start a clean session.
        </p>
        <pre className='mt-4 overflow-x-auto rounded bg-gray-100 p-4 text-sm'>
          {this.state.error.message || 'Unexpected error'}
        </pre>
        <button
          className='mt-4 rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white'
          type='button'
          onClick={() => window.location.reload()}
        >
          Refresh page
        </button>
      </main>
    )
  }
}
