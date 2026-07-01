import { useCallback, useMemo, useRef, useState } from 'react'

import { delay } from '@/utils/async'

import { TxProgressContext } from './TxProgressContext'
import type { StartTxProgress, TransactionSteps } from './types'

// Software signers (seed) sign synchronously, so steps can otherwise flash by
// in a few ms. Hold each step on screen at least this long so the stepper reads.
const MIN_STAGE_DURATION_MS = 2000

export function TxProgressProvider({ children }: { children: React.ReactNode }) {
  const [steps, setSteps] = useState<TransactionSteps>([])
  const [currentStepId, setCurrentStepId] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const lastChangeAtRef = useRef(0)

  const advance = useCallback(async (stepId: string) => {
    const elapsed = Date.now() - lastChangeAtRef.current
    if (elapsed < MIN_STAGE_DURATION_MS) {
      await delay(MIN_STAGE_DURATION_MS - elapsed)
    }
    lastChangeAtRef.current = Date.now()
    setCurrentStepId(stepId)
  }, [])

  const startTxProgress = useCallback<StartTxProgress>(
    newSteps => {
      setErrorMessage(null)
      setSteps(newSteps)
      setCurrentStepId(newSteps[0]?.id ?? null)
      lastChangeAtRef.current = Date.now()

      return stepId => advance(stepId)
    },
    [advance],
  )

  const setTxProgressError = useCallback((error: unknown) => {
    setErrorMessage(error instanceof Error ? error.message : String(error))
  }, [])

  const value = useMemo(
    () => ({
      steps,
      currentStepId,
      errorMessage,
      startTxProgress,
      setTxProgressError,
    }),
    [steps, currentStepId, errorMessage, startTxProgress, setTxProgressError],
  )

  return <TxProgressContext.Provider value={value}>{children}</TxProgressContext.Provider>
}
