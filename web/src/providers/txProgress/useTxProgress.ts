import { useContext } from 'react'

import { TX_PROGRESS_CONTEXT_UNINITIALIZED, TxProgressContext } from './TxProgressContext'
import type { TxProgressContextValue } from './types'

export function useTxProgress(): TxProgressContextValue {
  const ctx = useContext(TxProgressContext)
  if (ctx === TX_PROGRESS_CONTEXT_UNINITIALIZED) {
    throw new Error('useTxProgress() must be used within <TxProgressProvider />')
  }
  return ctx
}
