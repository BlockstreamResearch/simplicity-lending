import { ToastProvider } from '@heroui/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import type { PropsWithChildren } from 'react'

import { env } from '@/constants/env'

import { AssetDenominationProvider } from './assetDenomination/AssetDenominationProvider'
import { IndexerSubscription } from './indexerEvents/IndexerSubscription'
import { LwkProvider } from './lwk/LwkProvider'
import { PendingTransactionsProvider } from './pendingTransactions/PendingTransactionsProvider'
import { pendingTxToastQueue } from './pendingTransactions/pendingTxToastQueue'
import { queryClient } from './queryClient'
import { TxProgressProvider } from './txProgress/TxProgressProvider'
import { WalletFacadeProvider } from './walletFacade/WalletFacadeProvider'

export function AppProviders({ children }: PropsWithChildren) {
  return (
    <QueryClientProvider client={queryClient}>
      <LwkProvider>
        <WalletFacadeProvider>
          <IndexerSubscription />
          <TxProgressProvider>
            <AssetDenominationProvider>
              <PendingTransactionsProvider>{children}</PendingTransactionsProvider>
            </AssetDenominationProvider>
            <ToastProvider placement='top end' />
            <ToastProvider queue={pendingTxToastQueue} placement='bottom' />
          </TxProgressProvider>
        </WalletFacadeProvider>
      </LwkProvider>
      {env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  )
}
