import { QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import type { PropsWithChildren } from 'react'

import { env } from '@/constants/env'

import { LwkProvider } from './lwk/LwkProvider'
import { queryClient } from './queryClient'
import { WalletProvider } from './wallet/WalletProvider'

export function AppProviders({ children }: PropsWithChildren) {
  return (
    <QueryClientProvider client={queryClient}>
      <LwkProvider>
        <WalletProvider>{children}</WalletProvider>
      </LwkProvider>
      {env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  )
}
