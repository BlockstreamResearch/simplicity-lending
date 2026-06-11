import { QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import type { PropsWithChildren } from 'react'

import { env } from '@/constants/env'

import { LwkProvider } from './lwk/LwkProvider'
import { NotificationsProvider } from './notifications/NotificationsProvider'
import { queryClient } from './queryClient'
import { WalletProvider } from './wallet/WalletProvider'

export function AppProviders({ children }: PropsWithChildren) {
  return (
    <QueryClientProvider client={queryClient}>
      <LwkProvider>
        <WalletProvider>
          <NotificationsProvider>{children}</NotificationsProvider>
        </WalletProvider>
      </LwkProvider>
      {env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  )
}
