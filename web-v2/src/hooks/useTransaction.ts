import { useCallback, useState } from 'react'

export type TransactionPhase = 'idle' | 'processing' | 'success' | 'error'

export interface TransactionState {
  phase: TransactionPhase
  txid: string | null
  error: string | null
  execute: (fn: () => Promise<string>) => Promise<void>
  resetTx: () => void
}

export function useTransaction(): TransactionState {
  const [phase, setPhase] = useState<TransactionPhase>('idle')
  const [txid, setTxid] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const execute = useCallback(async (fn: () => Promise<string>) => {
    setPhase('processing')
    setError(null)
    setTxid(null)
    try {
      const id = await fn()
      setTxid(id)
      setPhase('success')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setPhase('error')
    }
  }, [])

  const resetTx = useCallback(() => {
    setPhase('idle')
    setTxid(null)
    setError(null)
  }, [])

  return { phase, txid, error, execute, resetTx }
}
