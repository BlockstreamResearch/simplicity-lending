import { createContext } from 'react'

import type { NetworkContextValue } from './types'

export const NETWORK_CONTEXT_UNINITIALIZED = Symbol('NETWORK_CONTEXT_UNINITIALIZED')

export const NetworkContext = createContext<
  NetworkContextValue | typeof NETWORK_CONTEXT_UNINITIALIZED
>(NETWORK_CONTEXT_UNINITIALIZED)
