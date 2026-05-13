import { useContext } from 'react'

import { NETWORK_CONTEXT_UNINITIALIZED, NetworkContext } from './NetworkContext'
import type { NetworkContextValue } from './types'

export function useNetwork(): NetworkContextValue {
  const ctx = useContext(NetworkContext)
  if (ctx === NETWORK_CONTEXT_UNINITIALIZED) {
    throw new Error('useNetwork() must be used within <NetworkProvider />')
  }
  return ctx
}
