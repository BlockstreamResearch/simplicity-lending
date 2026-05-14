import { createContext } from 'react'

import type { LwkContextValue } from './types'

export const LWK_CONTEXT_UNINITIALIZED = Symbol('LWK_CONTEXT_UNINITIALIZED')

export const LwkContext = createContext<LwkContextValue | typeof LWK_CONTEXT_UNINITIALIZED>(
  LWK_CONTEXT_UNINITIALIZED,
)
