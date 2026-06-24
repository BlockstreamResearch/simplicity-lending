import { useContext } from 'react'

import { LWK_CONTEXT_UNINITIALIZED, LwkContext } from './LwkContext'
import type { LwkContextValue } from './types'

export function useLwk(): LwkContextValue {
  const ctx = useContext(LwkContext)
  if (ctx === LWK_CONTEXT_UNINITIALIZED) {
    throw new Error('useLwk() must be used within <LwkProvider />')
  }
  return ctx
}
