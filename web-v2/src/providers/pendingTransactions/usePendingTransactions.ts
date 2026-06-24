import { useContext } from 'react'

import {
  PENDING_TRANSACTIONS_CONTEXT_UNINITIALIZED,
  PendingTransactionsContext,
} from './PendingTransactionsContext'
import type { PendingTransactionsContextValue } from './types'

export function usePendingTransactions(): PendingTransactionsContextValue {
  const ctx = useContext(PendingTransactionsContext)
  if (ctx === PENDING_TRANSACTIONS_CONTEXT_UNINITIALIZED) {
    throw new Error('usePendingTransactions() must be used within <PendingTransactionsProvider />')
  }
  return ctx
}
