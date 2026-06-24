import { ToastProvider } from '@heroui/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import type { PropsWithChildren } from 'react'

import { env } from '@/constants/env'

import { AssetDenominationProvider } from './assetDenomination/AssetDenominationProvider'
import { LwkProvider } from './lwk/LwkProvider'
import { PendingTransactionsProvider } from './pendingTransactions/PendingTransactionsProvider'
import { pendingTxToastQueue } from './pendingTransactions/pendingTxToastQueue'
import { queryClient } from './queryClient'
import { WalletProvider } from './wallet/WalletProvider'

export function AppProviders({ children }: PropsWithChildren) {
  return (
    <QueryClientProvider client={queryClient}>
      <LwkProvider>
        <WalletProvider>
          <AssetDenominationProvider>
            <PendingTransactionsProvider>{children}</PendingTransactionsProvider>
          </AssetDenominationProvider>
          <ToastProvider placement='top end' />
          <ToastProvider queue={pendingTxToastQueue} placement='bottom' />
        </WalletProvider>
      </LwkProvider>
      {env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  )
}
