import { useContext } from 'react'

import { HUMID_CONTEXT_UNINITIALIZED, HumidContext } from './HumidContext'
import type { HumidContextValue } from './types'

export function useHumid(): HumidContextValue {
  const ctx = useContext(HumidContext)
  if (ctx === HUMID_CONTEXT_UNINITIALIZED) {
    throw new Error('useHumid() must be used within <HumidProvider />')
  }
  return ctx
}
