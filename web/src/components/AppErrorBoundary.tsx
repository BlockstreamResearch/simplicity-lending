import { Component, type ErrorInfo, type PropsWithChildren, type ReactNode } from 'react'

import { ErrorScreen } from '@/components/ErrorScreen'
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
      <ErrorScreen
        title='Application error'
        description={ErrorHandler.describe(this.state.error)}
        actionLabel='Reload page'
        onAction={() => {
          window.location.reload()
        }}
      />
    )
  }
}
