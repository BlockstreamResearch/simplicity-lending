import { createContext, useContext } from 'react'

export interface SeedContextValue {
  seedHex: string
  accountIndex: number
  /** Returns the 32-byte secret key for the current account (derived from seed + accountIndex). */
  getCurrentSecretKey: () => Uint8Array
}

export const SeedContext = createContext<SeedContextValue | null>(null)

export function useSeedHex(): string | null {
  const ctx = useContext(SeedContext)
  return ctx?.seedHex ?? null
}

export function useSeedContext(): SeedContextValue | null {
  return useContext(SeedContext)
}
