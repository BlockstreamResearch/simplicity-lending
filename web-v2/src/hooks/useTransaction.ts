import { useMutation } from '@tanstack/react-query'
import { useCallback, useMemo } from 'react'

export type TransactionPhase = 'idle' | 'processing' | 'success' | 'error'

export interface TransactionState {
  phase: TransactionPhase
  txid: string | null
  error: string | null
  execute: (fn: () => Promise<string>) => Promise<void>
  resetTx: () => void
}

export function useTransaction(): TransactionState {
  const { mutateAsync, reset, data, error, isPending, isSuccess, isError } = useMutation<
    string,
    Error,
    () => Promise<string>
  >({
    mutationFn: fn => fn(),
  })

  const phase: TransactionPhase = useMemo(() => {
    if (isPending) return 'processing'
    if (isError) return 'error'
    if (isSuccess) return 'success'
    return 'idle'
  }, [isPending, isError, isSuccess])

  const execute = useCallback(
    async (fn: () => Promise<string>) => {
      try {
        await mutateAsync(fn)
      } catch {
        return
      }
    },
    [mutateAsync],
  )

  return { phase, txid: data ?? null, error: error?.message ?? null, execute, resetTx: reset }
}
