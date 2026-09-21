import { createContext } from 'react'

import type { HumidContextValue } from './types'

export const HUMID_CONTEXT_UNINITIALIZED = Symbol('HUMID_CONTEXT_UNINITIALIZED')

export const HumidContext = createContext<HumidContextValue | typeof HUMID_CONTEXT_UNINITIALIZED>(
  HUMID_CONTEXT_UNINITIALIZED,
)
