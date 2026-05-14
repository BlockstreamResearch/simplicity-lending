import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { PropsWithChildren } from 'react'

import { LwkProvider } from './lwk/LwkProvider'

const queryClient = new QueryClient()

export function AppProviders({ children }: PropsWithChildren) {
  return (
    <QueryClientProvider client={queryClient}>
      <LwkProvider>{children}</LwkProvider>
    </QueryClientProvider>
  )
}
