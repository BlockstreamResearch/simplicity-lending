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

/**
 * The chain library where a page has one, and null where it has not.
 *
 * A wallet adapter is built on every render whether or not anyone picked it, and one that is not
 * picked needs nothing from the chain library. Reading it strictly would make merely listing the
 * wallets require the module to be loaded, which is the opposite of an adapter that is inert until
 * it is connected. What needs it says so when it is used.
 */
export function useOptionalLwk(): LwkContextValue | null {
  const ctx = useContext(LwkContext)

  return ctx === LWK_CONTEXT_UNINITIALIZED ? null : ctx
}
