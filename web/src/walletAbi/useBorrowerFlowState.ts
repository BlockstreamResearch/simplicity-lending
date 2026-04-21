import { useCallback, useEffect, useState } from 'react'
import {
  clearBorrowerFlowState,
  loadBorrowerFlowState,
  saveBorrowerFlowState,
  type WalletAbiBorrowerFlowState,
} from './storage'

export function useBorrowerFlowState(address: string | null) {
  const [state, setState] = useState<WalletAbiBorrowerFlowState>(() => loadBorrowerFlowState(address))

  useEffect(() => {
    setState(loadBorrowerFlowState(address))
  }, [address])

  const patch = useCallback(
    (nextPatch: Partial<WalletAbiBorrowerFlowState>) => {
      const nextState = saveBorrowerFlowState(address, nextPatch)
      setState(nextState)
      return nextState
    },
    [address]
  )

  const clear = useCallback(() => {
    clearBorrowerFlowState(address)
    setState(loadBorrowerFlowState(address))
  }, [address])

  return {
    state,
    patch,
    clear,
  }
}

