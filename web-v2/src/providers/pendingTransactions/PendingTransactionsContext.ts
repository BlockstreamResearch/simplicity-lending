import { createContext } from 'react'

import type { PendingTransactionsContextValue } from './types'

export const PENDING_TRANSACTIONS_CONTEXT_UNINITIALIZED = Symbol(
  'PENDING_TRANSACTIONS_CONTEXT_UNINITIALIZED',
)

export const PendingTransactionsContext = createContext<
  PendingTransactionsContextValue | typeof PENDING_TRANSACTIONS_CONTEXT_UNINITIALIZED
>(PENDING_TRANSACTIONS_CONTEXT_UNINITIALIZED)
