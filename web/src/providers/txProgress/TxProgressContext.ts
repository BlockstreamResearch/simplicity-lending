import { createContext } from 'react'

import type { TxProgressContextValue } from './types'

export const TX_PROGRESS_CONTEXT_UNINITIALIZED = Symbol('TX_PROGRESS_CONTEXT_UNINITIALIZED')

export const TxProgressContext = createContext<
  TxProgressContextValue | typeof TX_PROGRESS_CONTEXT_UNINITIALIZED
>(TX_PROGRESS_CONTEXT_UNINITIALIZED)
